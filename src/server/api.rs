//! The router: pages, assets, the JSON API and the Host guard.

use std::sync::Arc;

use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, FromRequest, Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde::{Deserialize, Serialize};

use super::guard::{self, DeleteRequest};
use super::{AppState, assets, events};
use crate::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
use crate::error::SkanError;
use crate::store::ProjectStore;

/// The largest request body any route reads.
const MAX_BODY: usize = 64 * 1024;

pub(crate) fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/assets/app.js", get(app_js))
        .route("/assets/app.css", get(app_css))
        .route("/logo.png", get(logo_png))
        .route("/logo-white.png", get(logo_white_png))
        .route("/api/events", get(events::events))
        .route("/api/notify", post(notify))
        .route("/api/health", get(health))
        .route("/api/projects", get(projects))
        .route("/api/projects/{project_id}/board", get(board))
        .route("/api/projects/{project_id}/cards", post(create_card))
        .route("/api/projects/{project_id}/cards/{id}", delete(delete_card))
        .route(
            "/api/projects/{project_id}/cards/{id}/move",
            post(move_card),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/agent-status",
            post(set_agent_status),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/answer",
            post(answer_request),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(middleware::from_fn_with_state(state.clone(), write_guard))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .with_state(state)
}

// ---------------------------------------------------------------- errors

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
    reason: String,
}

fn error_response(
    status: StatusCode,
    code: &str,
    message: impl Into<String>,
    reason: impl Into<String>,
) -> Response {
    let body = ErrorBody {
        error: ErrorDetail {
            code: code.to_string(),
            message: message.into(),
            reason: reason.into(),
        },
    };
    json_response(status, &body)
}

fn skan_error_response(error: &SkanError) -> Response {
    let status = match error {
        SkanError::CardNotFound { .. } | SkanError::ProjectNotFound { .. } => StatusCode::NOT_FOUND,
        SkanError::NotInitialized
        | SkanError::RequestChanged
        | SkanError::ProjectNameExists { .. } => StatusCode::CONFLICT,
        SkanError::InvalidArgument { .. }
        | SkanError::InvalidValue { .. }
        | SkanError::InvalidStateForColumn { .. }
        | SkanError::InvalidStateForAssignee => StatusCode::UNPROCESSABLE_ENTITY,
        SkanError::DatabaseBusy => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_response(status, error.code(), error.message(), error.reason())
}

fn forbidden(reason: &str) -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "forbidden",
        "request is not allowed.",
        reason,
    )
}

fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
    match serde_json::to_vec(body) {
        Ok(bytes) => (
            status,
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ---------------------------------------------------------------- guards

/// The single text value of a header, or `None` if it is absent, repeated or
/// not text.
fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

/// Every request, whatever the path, needs an accepted `Host`.
async fn host_guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    if guard::host_allowed(header_text(request.headers(), "host"), state.port) {
        next.run(request).await
    } else {
        forbidden("Open the board at http://127.0.0.1:<port>/ as printed by agboard serve.")
    }
}

/// Every request that changes data needs the page's Origin, Sec-Fetch-Site and
/// token. This runs before the path, the body or the database is looked at, so
/// a refusal never tells whether a project or card exists. `POST /api/notify`
/// changes nothing and is open.
async fn write_guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let reads = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if reads || request.uri().path() == "/api/notify" || write_allowed(request.headers(), &state) {
        next.run(request).await
    } else {
        forbidden("Changes can only be made from the board page.")
    }
}

/// A JSON body whose failures use the API's error body: 400 for broken JSON,
/// 413 for a body over the limit, 415 for another content type, and 422 for
/// JSON that is well formed but not what the route takes.
struct ApiJson<T>(T);

impl<S: Send + Sync, T: serde::de::DeserializeOwned> FromRequest<S> for ApiJson<T> {
    type Rejection = Response;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(request, state).await {
            Ok(axum::Json(value)) => Ok(ApiJson(value)),
            Err(rejection) => Err(json_rejection(&rejection)),
        }
    }
}

fn json_rejection(rejection: &JsonRejection) -> Response {
    let (status, code, reason) = match rejection.status() {
        StatusCode::PAYLOAD_TOO_LARGE => (
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "Request bodies are limited to 64 KiB.",
        ),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => (
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "Send the body as application/json.",
        ),
        StatusCode::UNPROCESSABLE_ENTITY => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "The body is missing a field or has a value the route does not accept.",
        ),
        _ => (
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "The body is not valid JSON.",
        ),
    };
    error_response(status, code, "request body is invalid.", reason)
}

// ---------------------------------------------------------------- store access

/// Open the database for one request and run `work` on a blocking thread.
async fn with_store<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(ProjectStore) -> Result<T, SkanError> + Send + 'static,
) -> Result<T, SkanError> {
    let path = state.db_path.clone();
    tokio::task::spawn_blocking(move || work(ProjectStore::open(&path)?))
        .await
        .map_err(|e| SkanError::DatabaseError {
            reason: format!("The database task failed: {e}"),
        })?
}

// ---------------------------------------------------------------- pages

fn text_response(content_type: &'static str, body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

async fn index(State(state): State<Arc<AppState>>) -> Response {
    text_response(
        "text/html; charset=utf-8",
        assets::render_index(assets::INDEX_HTML, &state.token),
    )
}

async fn app_js() -> Response {
    text_response("text/javascript; charset=utf-8", assets::APP_JS.to_string())
}

async fn app_css() -> Response {
    text_response("text/css; charset=utf-8", assets::APP_CSS.to_string())
}

async fn logo_png() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        assets::LOGO_PNG,
    )
        .into_response()
}

async fn logo_white_png() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        assets::LOGO_WHITE_PNG,
    )
        .into_response()
}

// ---------------------------------------------------------------- API

/// The project named in the URL. The URL is a name for a project, never a
/// credential: an ID that is not well formed is `invalid_value`.
fn parse_project_id(raw: &str) -> Result<ProjectId, SkanError> {
    raw.parse()
}

/// The catalog: every project by name, without cards. Read in one transaction.
async fn projects(State(state): State<Arc<AppState>>) -> Response {
    match with_store(&state, |store| store.projects()).await {
        Ok(catalog) => json_response(StatusCode::OK, &catalog),
        Err(error) => skan_error_response(&error),
    }
}

async fn board(State(state): State<Arc<AppState>>, Path(raw_project): Path<String>) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    match with_store(&state, move |store| store.snapshot(&project_id)).await {
        Ok(snapshot) => {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct BoardInfo {
                name: String,
                #[serde(with = "crate::clock::serde_utc")]
                created_at: chrono::DateTime<chrono::Utc>,
            }
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct BoardResponse {
                project: crate::domain::ProjectMeta,
                board: BoardInfo,
                revision: i64,
                cursor: crate::domain::ChangeCursor,
                cards: Vec<crate::domain::Card>,
            }
            json_response(
                StatusCode::OK,
                &BoardResponse {
                    project: snapshot.project,
                    board: BoardInfo {
                        name: snapshot.board.name,
                        created_at: snapshot.board.created_at,
                    },
                    revision: snapshot.revision,
                    cursor: snapshot.cursor,
                    cards: snapshot.cards,
                },
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn health() -> Response {
    #[derive(Serialize)]
    struct Health {
        ok: bool,
        pid: u32,
    }
    json_response(
        StatusCode::OK,
        &Health {
            ok: true,
            pid: std::process::id(),
        },
    )
}

/// A change was made elsewhere (the CLI). Tell every connected browser.
async fn notify(State(state): State<Arc<AppState>>) -> StatusCode {
    let _ = state.changed.send(());
    StatusCode::NO_CONTENT
}

async fn delete_card(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            format!("card {raw_id} not found."),
            "Card IDs are positive whole numbers.",
        );
    };
    match with_store(&state, move |store| store.delete_card(&project_id, id)).await {
        Ok(()) => {
            let _ = state.changed.send(());
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => skan_error_response(&error),
    }
}

fn write_allowed(headers: &HeaderMap, state: &AppState) -> bool {
    let request = DeleteRequest {
        host: header_text(headers, "host"),
        origin: header_text(headers, "origin"),
        sec_fetch_site: header_text(headers, "sec-fetch-site"),
        token: header_text(headers, "x-skan-token"),
    };
    guard::check_delete(&request, state.port, &state.token).is_ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateCardInput {
    title: String,
    description: String,
    assignee: Assignee,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveInput {
    card_status: Column,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentStateInput {
    agent_status: RunState,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    reason: String,
    request_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnswerInput {
    request_id: String,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    reason: String,
}

async fn create_card(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<CreateCardInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    match with_store(&state, move |store| {
        store.add_work_card(
            &project_id,
            NewCard {
                title: input.title,
                description: input.description,
                assignee: input.assignee,
                actor: Actor::Human,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(card) => {
            let _ = state.changed.send(());
            json_response(StatusCode::CREATED, &serde_json::json!({"card": card}))
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn move_card(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<MoveInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            "card not found.",
            "Card ID is invalid.",
        );
    };
    match with_store(&state, move |store| {
        store.move_work_card(
            &project_id,
            id,
            input.card_status,
            ChangeContext {
                actor: Actor::Human,
                reason: input.reason,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(result) => {
            if result.changed {
                let _ = state.changed.send(());
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"card": result.value, "changed": result.changed}),
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn set_agent_status(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AgentStateInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            "card not found.",
            "Card ID is invalid.",
        );
    };
    match with_store(&state, move |store| {
        store.set_agent_status(
            &project_id,
            id,
            input.agent_status,
            ChangeContext {
                actor: Actor::Human,
                reason: input.reason,
            },
            input.request_id.as_deref(),
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(result) => {
            if result.changed {
                let _ = state.changed.send(());
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"card": result.value, "changed": result.changed}),
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn answer_request(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AnswerInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            "card not found.",
            "Card ID is invalid.",
        );
    };
    match with_store(&state, move |store| {
        store.answer_request(
            &project_id,
            id,
            &input.request_id,
            ChangeContext {
                actor: Actor::Human,
                reason: input.reason,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(card) => {
            let _ = state.changed.send(());
            json_response(
                StatusCode::OK,
                &serde_json::json!({"card": card, "changed": true}),
            )
        }
        Err(error) => skan_error_response(&error),
    }
}
