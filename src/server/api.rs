//! The router: pages, assets, the JSON API and the Host guard.

use std::sync::Arc;

use axum::Router;
use axum::body::to_bytes;
use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use serde::{Deserialize, Serialize};

use super::guard::{self, DeleteRequest};
use super::{AppState, assets, events};
use crate::domain::{
    Actor, Assignee, ChangeContext, Changed, Column, NewCard, ProjectId, RunState,
};
use crate::error::SkanError;
use crate::file_store::index::ProjectEntry;
use crate::file_store::model::CardView;
use crate::file_store::{Answer, FileStore};

/// The largest request body any route reads. A description of 50,000
/// characters can be about 150 KB of JSON, so this leaves room for that.
const MAX_BODY: usize = 1024 * 1024;
const MAX_MULTIPART_BODY: usize = 52 * 1024 * 1024;

/// What the board page may load and do. Scripts, fonts and connections stay on
/// this server; images may come from anywhere so a description can show them.
/// `'unsafe-inline'` for styles is needed because the editor inserts `<style>`
/// elements at run time.
const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub(crate) fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/assets/app.js", get(app_js))
        .route("/assets/app.css", get(app_css))
        .route("/assets/{name}", get(chunk))
        .route("/logo.png", get(logo_png))
        .route("/logo-white.png", get(logo_white_png))
        .route("/api/events", get(events::events))
        .route("/api/notify", post(notify))
        .route("/api/health", get(health))
        .route("/api/projects", get(projects))
        .route("/api/projects/{project_id}/board", get(board))
        .route("/api/projects/{project_id}/archive", get(archive))
        .route("/api/projects/{project_id}/cards", post(create_card))
        .route(
            "/api/projects/{project_id}/cards/multipart",
            post(create_card_multipart),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}",
            delete(delete_card).patch(edit_card),
        )
        .route(
            "/api/projects/{project_id}/cards/archive-done",
            post(archive_done),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/archive",
            post(archive_card),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/restore",
            post(restore_card),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/multipart",
            patch(edit_card_multipart),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/attachments",
            patch(edit_card_multipart),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/attachments/{attachment_id}",
            get(get_attachment),
        )
        .route(
            "/api/projects/{project_id}/cards/{id}/draft",
            put(set_draft),
        )
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
        .layer(DefaultBodyLimit::max(MAX_MULTIPART_BODY))
        .layer(middleware::from_fn_with_state(state.clone(), write_guard))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(middleware::from_fn(no_referrer))
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
        SkanError::CardNotFound { .. }
        | SkanError::ProjectNotFound { .. }
        | SkanError::AttachmentNotFound { .. } => StatusCode::NOT_FOUND,
        SkanError::NotInitialized
        | SkanError::RequestChanged
        | SkanError::CardIsDraft { .. }
        | SkanError::CardNotDraft { .. }
        | SkanError::InvalidStateForDraft { .. }
        | SkanError::ProjectNameExists { .. }
        | SkanError::AttachmentRequestConflict => StatusCode::CONFLICT,
        SkanError::CardArchived { .. }
        | SkanError::CardNotArchived { .. }
        | SkanError::ArchiveTargetsChanged => StatusCode::CONFLICT,
        SkanError::InvalidArgument { .. }
        | SkanError::InvalidValue { .. }
        | SkanError::FileInvalid { .. }
        | SkanError::InvalidStateForColumn { .. }
        | SkanError::InvalidStateForAssignee
        | SkanError::AttachmentLimitExceeded => StatusCode::UNPROCESSABLE_ENTITY,
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

/// Every response tells the browser not to send a `Referer`.
async fn no_referrer(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    response
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

    async fn from_request(request: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !content_type
            .split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "request body is invalid.",
                "Send the body as application/json.",
            ));
        }
        let body = to_bytes(request.into_body(), MAX_BODY).await.map_err(|_| {
            error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Request bodies are limited to 1 MiB.",
            )
        })?;
        match serde_json::from_slice::<T>(&body) {
            Ok(value) => Ok(ApiJson(value)),
            Err(error) if error.is_data() => Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "The body is missing a field or has a value the route does not accept.",
            )),
            Err(_) => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body is not valid JSON.",
            )),
        }
    }
}

/// Like [`ApiJson`], but a field the route does not take is a broken request
/// (400) rather than a value it does not accept (422).
struct StrictJson<T>(T);

impl<S: Send + Sync, T: serde::de::DeserializeOwned> FromRequest<S> for StrictJson<T> {
    type Rejection = Response;

    async fn from_request(request: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !content_type
            .split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "request body is invalid.",
                "Send the body as application/json.",
            ));
        }
        let body = to_bytes(request.into_body(), MAX_BODY).await.map_err(|_| {
            error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Request bodies are limited to 1 MiB.",
            )
        })?;
        match serde_json::from_slice::<T>(&body) {
            Ok(value) => Ok(StrictJson(value)),
            Err(error) if error.to_string().contains("unknown field") => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body has a field this route does not take.",
            )),
            Err(error) if error.is_data() => Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "The body is missing a field or has a value the route does not accept.",
            )),
            Err(_) => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body is not valid JSON.",
            )),
        }
    }
}

// ---------------------------------------------------------------- store access

/// Run `work` on the shared files on a blocking thread.
async fn with_files<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(FileStore) -> Result<T, SkanError> + Send + 'static,
) -> Result<T, SkanError> {
    let shared = state.shared.clone();
    tokio::task::spawn_blocking(move || work(FileStore::open(&shared)))
        .await
        .map_err(|e| SkanError::DatabaseError {
            reason: format!("The file task failed: {e}"),
        })?
}

/// After a save made by this server, read the shared files again before the
/// answer goes out, so the next read agrees with it. A `changed` is sent only
/// if the catalog version moved, as for every other reload.
fn refresh_index(state: &AppState) {
    let mut index = state.index.write().unwrap_or_else(|e| e.into_inner());
    if index.reload_all(&state.shared).unwrap_or(false) {
        let _ = state.changed.send(());
    }
}

/// The attachments are not in the shared files yet; a request that adds or
/// removes one is refused with this answer until the attachment operations land.
fn attachments_unavailable() -> Response {
    error_response(
        StatusCode::NOT_IMPLEMENTED,
        "not_implemented",
        "request body is invalid.",
        "Image attachments are not stored in the shared files yet.",
    )
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
    let mut response = text_response(
        "text/html; charset=utf-8",
        assets::render_index(assets::INDEX_HTML, &state.token),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    response
}

async fn app_js() -> Response {
    text_response("text/javascript; charset=utf-8", assets::APP_JS.to_string())
}

async fn app_css() -> Response {
    text_response("text/css; charset=utf-8", assets::APP_CSS.to_string())
}

/// An on-demand web chunk. Only names in the build's table are served; the
/// file name is looked up, never joined to a path. Chunks are named by their
/// content hash, so they never change and can be cached for a year.
async fn chunk(Path(name): Path<String>) -> Response {
    match assets::lookup(&name) {
        Some((bytes, content_type)) => (
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
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
    match with_files(&state, |files| files.catalog()).await {
        Ok(catalog) => json_response(StatusCode::OK, &catalog),
        Err(error) => skan_error_response(&error),
    }
}

/// The project's index entry as its last good read, or the error of a defective
/// project. A project that is not in the index is `project_not_found`.
fn indexed_view(
    state: &AppState,
    id: &ProjectId,
) -> Result<Arc<crate::file_store::reader::ProjectSnapshot>, SkanError> {
    // A folder that is gone is a deleted project, even before the watcher reloads.
    if !crate::file_store::layout::project_dir(&state.shared, id).is_dir() {
        return Err(SkanError::ProjectNotFound {
            project: id.to_string(),
        });
    }
    let index = state.index.read().unwrap_or_else(|e| e.into_inner());
    match index.entry(id) {
        None => Err(SkanError::ProjectNotFound {
            project: id.to_string(),
        }),
        Some(ProjectEntry::Ready { view, .. }) => Ok(view.clone()),
        Some(ProjectEntry::Invalid { error, .. }) => Err(match error {
            SkanError::FileInvalid {
                file,
                field,
                reason,
            } => SkanError::FileInvalid {
                file: file.clone(),
                field: field.clone(),
                reason: reason.clone(),
            },
            other => SkanError::FileError {
                action: crate::error::FileAction::Read,
                file: id.to_string(),
                reason: other.reason(),
            },
        }),
    }
}

async fn board(State(state): State<Arc<AppState>>, Path(raw_project): Path<String>) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct BoardResponse<'a> {
                project: &'a crate::domain::ProjectMeta,
                version: &'a str,
                cursor: &'a crate::domain::ChangeCursor,
                epics: &'a [crate::file_store::model::EpicView],
                cards: Vec<&'a CardView>,
                problems: &'a [crate::file_store::model::Problem],
            }
            let cards = view
                .cards
                .iter()
                .filter(|c| c.archived_at.is_none())
                .collect();
            json_response(
                StatusCode::OK,
                &BoardResponse {
                    project: &view.project,
                    version: &view.version,
                    cursor: &view.cursor,
                    epics: &view.epics,
                    cards,
                    problems: &view.problems,
                },
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn archive(State(state): State<Arc<AppState>>, Path(raw_project): Path<String>) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => json_response(
            StatusCode::OK,
            &serde_json::json!({
                "project": view.project,
                "version": view.version,
                "cursor": view.cursor,
                "cards": view.cards.iter().filter(|c| c.archived_at.is_some()).collect::<Vec<_>>(),
            }),
        ),
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

/// A change was made elsewhere (the CLI). Queue a reload of every project; the
/// browsers hear about it only if a version actually changed.
async fn notify(State(state): State<Arc<AppState>>) -> StatusCode {
    state.reloader.all();
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
    match with_files(&state, move |store| {
        store.delete_archived_card(&project_id, id)
    })
    .await
    {
        Ok(()) => {
            refresh_index(&state);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn archive_card(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.archive_card(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_card_response(&state, result)
}

async fn restore_card(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.restore_card(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_card_response(&state, result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArchiveDoneInput {
    ids: Vec<i64>,
}

async fn archive_done(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    StrictJson(input): StrictJson<ArchiveDoneInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let result = with_files(&state, move |store| {
        store.archive_done(&project_id, &input.ids, chrono::Utc::now())
    })
    .await;
    match result {
        Ok(result) => {
            if result.changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({
                    "cards": result.value.cards,
                    "archivedCount": result.value.archived_count,
                }),
            )
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
struct EditCardInput {
    title: Option<String>,
    description: Option<String>,
    #[serde(default)]
    finalize: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftInput {
    is_draft: bool,
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
    #[serde(alias = "requestID")]
    request_id: String,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MultipartMeta {
    request_id: String,
    #[serde(default)]
    finalize: bool,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    assignee: Option<Assignee>,
    #[serde(default)]
    #[serde(alias = "removeAttachments", alias = "removeAttachmentIds")]
    remove_attachment_ids: Vec<String>,
    #[serde(default, alias = "files", alias = "additions")]
    attachments: Vec<MultipartAttachmentMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MultipartAttachmentMeta {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

struct MultipartPayload {
    meta: MultipartMeta,
    additions: Vec<crate::domain::AttachmentInput>,
}

async fn parse_multipart(mut multipart: Multipart) -> Result<MultipartPayload, Response> {
    let mut metadata = None;
    let mut files = Vec::new();
    let mut metadata_bytes = 0usize;
    while let Some(field) = multipart.next_field().await.map_err(|_| {
        error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_multipart",
            "request body is invalid.",
            "The multipart body could not be read.",
        )
    })? {
        let name = field.name().unwrap_or_default().to_owned();
        if matches!(name.as_str(), "metadata" | "meta" | "json") {
            let bytes = field.bytes().await.map_err(|_| {
                error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "The metadata part could not be read.",
                )
            })?;
            metadata_bytes += bytes.len();
            if metadata_bytes > MAX_BODY {
                return Err(error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "payload_too_large",
                    "request body is invalid.",
                    "Multipart metadata is limited to 1 MiB.",
                ));
            }
            if metadata.is_some() {
                return Err(error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "Send exactly one metadata part.",
                ));
            }
            metadata = Some(
                serde_json::from_slice::<MultipartMeta>(&bytes).map_err(|_| {
                    error_response(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid_value",
                        "request body is invalid.",
                        "The metadata part is not valid for this route.",
                    )
                })?,
            );
        } else if matches!(
            name.as_str(),
            "file" | "files" | "attachment" | "attachments"
        ) {
            let filename = field.file_name().unwrap_or("attachment").to_owned();
            let bytes = field.bytes().await.map_err(|_| {
                error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "An image part could not be read.",
                )
            })?;
            files.push((filename, bytes.to_vec()));
        } else {
            return Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_multipart",
                "request body is invalid.",
                "The multipart body contains an unknown part.",
            ));
        }
    }
    let meta = metadata.ok_or_else(|| {
        error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "A metadata part is required.",
        )
    })?;
    if files.len() > crate::domain::MAX_CARD_ATTACHMENTS {
        return Err(error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "attachment_limit_exceeded",
            "request body is invalid.",
            "A request may contain at most 20 images.",
        ));
    }
    if files.len() != meta.attachments.len() {
        return Err(error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "Each image must have one attachment metadata entry.",
        ));
    }
    let additions = files
        .into_iter()
        .zip(meta.attachments.iter())
        .map(|((filename, bytes), item)| crate::domain::AttachmentInput {
            id: item.id.clone(),
            name: item.name.clone().unwrap_or(filename),
            bytes,
        })
        .collect();
    Ok(MultipartPayload { meta, additions })
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
    match with_files(&state, move |store| {
        store.create_card(
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
            refresh_index(&state);
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
    match with_files(&state, move |store| {
        store.move_work_card_for_user(
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
                refresh_index(&state);
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
    match with_files(&state, move |store| {
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
                refresh_index(&state);
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
    match with_files(&state, move |store| {
        store.answer_request(
            &project_id,
            id,
            &input.request_id,
            Answer {
                actor: Actor::Human,
                choice_id: None,
                text: Some(input.reason),
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(card) => {
            refresh_index(&state);
            json_response(
                StatusCode::OK,
                &serde_json::json!({"card": card, "changed": true}),
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

/// A card ID from the URL; one that cannot be a card is `card_not_found`.
fn parse_card_id(raw: &str) -> Result<i64, Box<Response>> {
    raw.parse::<i64>().map_err(|_| {
        Box::new(error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            "card not found.",
            "Card ID is invalid.",
        ))
    })
}

/// A card as `{"card": ...}`, telling the browsers only if something changed.
fn changed_card_response(
    state: &AppState,
    result: Result<Changed<CardView>, SkanError>,
) -> Response {
    match result {
        Ok(result) => {
            if result.changed {
                refresh_index(state);
            }
            json_response(StatusCode::OK, &serde_json::json!({"card": result.value}))
        }
        Err(error) => skan_error_response(&error),
    }
}

/// Save the title and description of a draft, and confirm it with `finalize`.
async fn edit_card(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<EditCardInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    if input.title.is_none() && input.description.is_none() && !input.finalize {
        return skan_error_response(&SkanError::InvalidArgument {
            message: "Nothing to change.".to_string(),
            command: None,
        });
    }
    let result = with_files(&state, move |store| {
        store.edit_draft_card(
            &project_id,
            id,
            input.title.as_deref(),
            input.description.as_deref(),
            input.finalize,
            chrono::Utc::now(),
        )
    })
    .await;
    changed_card_response(&state, result)
}

async fn edit_card_multipart(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let multipart = match multipart {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Multipart bodies are limited to 52 MiB.",
            );
        }
    };
    let payload = match parse_multipart(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if payload.meta.request_id.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "requestId is required.",
        );
    }
    if !payload.additions.is_empty() || !payload.meta.remove_attachment_ids.is_empty() {
        return attachments_unavailable();
    }
    let finalize = payload.meta.finalize;
    let title = payload.meta.title;
    let description = payload.meta.description;
    let result = with_files(&state, move |store| {
        store.edit_draft_card(
            &project_id,
            id,
            title.as_deref(),
            description.as_deref(),
            finalize,
            chrono::Utc::now(),
        )
    })
    .await;
    match result {
        Ok(Changed { value, changed }) => {
            if changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"card": value, "changed": changed}),
            )
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn create_card_multipart(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let multipart = match multipart {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Multipart bodies are limited to 52 MiB.",
            );
        }
    };
    let payload = match parse_multipart(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(title) = payload.meta.title else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "title is required.",
        );
    };
    let Some(description) = payload.meta.description else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "description is required.",
        );
    };
    let Some(assignee) = payload.meta.assignee else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "assignee is required.",
        );
    };
    if !payload.meta.remove_attachment_ids.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "A new card cannot remove attachments.",
        );
    }
    let request_id = payload.meta.request_id;
    if request_id.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "requestId is required.",
        );
    }
    if !payload.additions.is_empty() {
        return attachments_unavailable();
    }
    let result = with_files(&state, move |store| {
        store.create_card(
            &project_id,
            NewCard {
                title,
                description,
                assignee,
                actor: Actor::Human,
            },
            chrono::Utc::now(),
        )
    })
    .await;
    match result {
        Ok(card) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"card": card}))
        }
        Err(error) => skan_error_response(&error),
    }
}

async fn get_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| store.card(&project_id, id)).await;
    match result {
        Ok(card) => match card.attachments.iter().find(|a| a.id == attachment_id) {
            None => skan_error_response(&SkanError::AttachmentNotFound { id: attachment_id }),
            Some(_) => attachments_unavailable(),
        },
        Err(error) => skan_error_response(&error),
    }
}

/// Turn the draft flag of a card on or off.
async fn set_draft(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<DraftInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return skan_error_response(&error),
    };
    let id = match parse_card_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.set_draft(&project_id, id, input.is_draft, chrono::Utc::now())
    })
    .await;
    changed_card_response(&state, result)
}
