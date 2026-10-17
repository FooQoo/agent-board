//! The router: pages, assets, the JSON API and the Host guard.

use std::sync::Arc;

use axum::Router;
use axum::body::to_bytes;
use axum::extract::{DefaultBodyLimit, Extension, FromRequest, Multipart, Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post, put};
use serde::{Deserialize, Deserializer, Serialize};

use super::guard::{self, DeleteRequest};
use super::{AppState, assets, events};
use crate::domain::{
    Actor, Assignee, ChangeContext, Changed, Column, NewTask, ProjectId, RunState,
    validate_attachment,
};
use crate::error::AgboardError;
use crate::file_store::frontmatter::{self, AcceptanceItem};
use crate::file_store::index::ProjectEntry;
use crate::file_store::model::{AttachmentOwner, Choice, EpicUpdate, NewEpic, TaskView};
use crate::file_store::validate::{self, EpicId};
use crate::file_store::{Answer, FileStore, TaskTextParts};

/// The largest request body any route reads. A description of 50,000
/// characters can be about 150 KB of JSON, so this leaves room for that.
const MAX_BODY: usize = 1024 * 1024;
const MAX_MULTIPART_BODY: usize = 52 * 1024 * 1024;

/// What the board page may load and do. Scripts, fonts and connections stay on
/// this server; images may come from anywhere so a description can show them.
/// `'unsafe-inline'` for styles is needed because the editor inserts `<style>`
/// elements at run time.
const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

#[derive(Clone)]
pub(crate) struct RemoteGuard {
    pub port: u16,
    pub origins: Arc<std::collections::HashSet<String>>,
    pub authorities: Arc<std::collections::HashSet<String>>,
    pub token: String,
}

#[derive(Clone)]
struct RemotePageToken(String);

#[derive(Clone)]
struct GuardContext {
    port: u16,
    token: String,
    remote: Option<RemoteGuard>,
}

pub(crate) fn router(state: Arc<AppState>) -> Router {
    routes(state, None)
}

pub(crate) fn remote_router(state: Arc<AppState>, guard: RemoteGuard) -> Router {
    routes(state, Some(guard))
}

fn routes(state: Arc<AppState>, remote: Option<RemoteGuard>) -> Router {
    let guard_context = GuardContext {
        port: remote.as_ref().map_or(state.port, |g| g.port),
        token: state.token.clone(),
        remote: remote.clone(),
    };
    let mut router = Router::new();
    if remote.is_none() {
        router = router.route("/", get(index));
    } else {
        router = router
            .route("/", get(access_index))
            .route("/board", get(board_redirect))
            .route("/board/", get(index))
            .route("/assets/access/entry.js", get(access_js));
    }
    router = router
        .route("/assets/app.js", get(app_js))
        .route("/assets/app.css", get(app_css))
        .route("/assets/{name}", get(chunk))
        .route("/logo.png", get(logo_png))
        .route("/logo-white.png", get(logo_white_png))
        .route("/api/events", get(events::events))
        .route("/api/projects", get(projects))
        .route("/api/projects/{project_id}/board", get(board))
        .route("/api/projects/{project_id}/archive", get(archive))
        .route("/api/projects/{project_id}/tasks", post(create_task))
        .route(
            "/api/projects/{project_id}/tasks/multipart",
            post(create_task_multipart),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}",
            delete(delete_task).patch(edit_task),
        )
        .route(
            "/api/projects/{project_id}/tasks/archive-done",
            post(archive_done),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/archive",
            post(archive_task),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/restore",
            post(restore_task),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/multipart",
            patch(edit_task_multipart),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/attachments",
            get(list_task_attachments)
                .post(add_task_attachment)
                .patch(edit_task_multipart),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/attachments/{attachment_id}",
            get(get_task_attachment).delete(delete_task_attachment),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/evidence",
            post(add_task_evidence),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/evidence/{evidence_id}",
            get(get_task_evidence).delete(delete_task_evidence),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/epic",
            put(set_task_epic),
        )
        .route(
            "/api/projects/{project_id}/epics",
            get(list_epics).post(create_epic),
        )
        .route(
            "/api/projects/{project_id}/epics/{epic_id}",
            get(get_epic).patch(update_epic),
        )
        .route(
            "/api/projects/{project_id}/epics/{epic_id}/attachments",
            get(list_epic_attachments).post(add_epic_attachment),
        )
        .route(
            "/api/projects/{project_id}/epics/{epic_id}/attachments/{attachment_id}",
            get(get_epic_attachment).delete(delete_epic_attachment),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/draft",
            put(set_draft),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/move",
            post(move_task),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/reorder",
            post(reorder_task),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/agent-status",
            post(set_agent_status),
        )
        .route(
            "/api/projects/{project_id}/tasks/{id}/answer",
            post(answer_request),
        );
    if remote.is_none() {
        router = router
            .route("/api/notify", post(notify))
            .route("/api/health", get(health));
    }
    router
        .layer(DefaultBodyLimit::max(MAX_MULTIPART_BODY))
        .layer(middleware::from_fn_with_state(
            guard_context.clone(),
            write_guard,
        ))
        .layer(middleware::from_fn_with_state(guard_context, host_guard))
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

pub(crate) fn agboard_error_response(error: &AgboardError) -> Response {
    let status = match error {
        AgboardError::TaskNotFound { .. }
        | AgboardError::ProjectNotFound { .. }
        | AgboardError::AttachmentNotFound { .. }
        | AgboardError::EvidenceNotFound { .. }
        | AgboardError::EpicNotFound { .. } => StatusCode::NOT_FOUND,
        AgboardError::RequestChanged
        | AgboardError::TaskIsDraft { .. }
        | AgboardError::TaskIsDone { .. }
        | AgboardError::TaskNotDraft { .. }
        | AgboardError::InvalidStateForDraft { .. }
        | AgboardError::ProjectNameExists { .. }
        | AgboardError::AttachmentRequestConflict
        | AgboardError::EpicIdTaken { .. }
        | AgboardError::EpicInUse { .. } => StatusCode::CONFLICT,
        AgboardError::TaskArchived { .. }
        | AgboardError::TaskNotArchived { .. }
        | AgboardError::ArchiveTargetsChanged => StatusCode::CONFLICT,
        AgboardError::InvalidArgument { .. }
        | AgboardError::InvalidValue { .. }
        | AgboardError::FileInvalid { .. }
        | AgboardError::InvalidStateForColumn { .. }
        | AgboardError::InvalidStateForAssignee
        | AgboardError::RequestChoiceUnknown { .. }
        | AgboardError::AttachmentLimitExceeded => StatusCode::UNPROCESSABLE_ENTITY,
        AgboardError::DatabaseBusy => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_response(status, error.code(), error.message(), error.reason())
}

pub(crate) fn forbidden(reason: &str) -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "forbidden",
        "request is not allowed.",
        reason,
    )
}

pub(crate) fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
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
    let private_api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    if private_api {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
    }
    response
}

/// Every request, whatever the path, needs an accepted `Host`.
async fn host_guard(State(context): State<GuardContext>, request: Request, next: Next) -> Response {
    let host = header_text(request.headers(), "host");
    let allowed = match &context.remote {
        Some(remote) => host.is_some_and(|h| {
            remote.authorities.contains(&h.to_ascii_lowercase())
                || h.eq_ignore_ascii_case(&format!("127.0.0.1:{}", remote.port))
        }),
        None => guard::host_allowed(host, context.port),
    };
    if allowed {
        let mut request = request;
        if let Some(remote) = &context.remote {
            request
                .extensions_mut()
                .insert(RemotePageToken(remote.token.clone()));
        }
        next.run(request).await
    } else {
        forbidden("Open the board at http://127.0.0.1:<port>/ as printed by agboard serve.")
    }
}

/// Every request that changes data needs the page's Origin, Sec-Fetch-Site and
/// token. This runs before the path, the body or the shared files are looked at, so
/// a refusal never tells whether a project or task exists. `POST /api/notify`
/// changes nothing and is open.
async fn write_guard(
    State(context): State<GuardContext>,
    request: Request,
    next: Next,
) -> Response {
    let reads = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    let protected_path = context.remote.is_none()
        || request.uri().path() == "/api/projects"
        || request.uri().path().starts_with("/api/projects/");
    let allowed = match &context.remote {
        Some(remote) if protected_path => remote_write_allowed(request.headers(), remote),
        Some(_) => true,
        None => write_allowed(request.headers(), &context),
    };
    if reads || (context.remote.is_none() && request.uri().path() == "/api/notify") || allowed {
        next.run(request).await
    } else if context.remote.is_none()
        && request.headers().contains_key("x-agboard-token")
        && matches!(
            write_refusal(request.headers(), &context),
            Some(guard::Denial::Token)
        )
    {
        page_out_of_date()
    } else {
        forbidden("Changes can only be made from the board page.")
    }
}

/// A JSON body whose failures use the API's error body: 400 for broken JSON,
/// 413 for a body over the limit, 415 for another content type, and 422 for
/// JSON that is well formed but not what the route takes.
pub(crate) struct ApiJson<T>(pub(crate) T);

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
    work: impl FnOnce(FileStore) -> Result<T, AgboardError> + Send + 'static,
) -> Result<T, AgboardError> {
    let shared = state.shared.clone();
    tokio::task::spawn_blocking(move || work(FileStore::open(&shared)))
        .await
        .map_err(|e| AgboardError::DatabaseError {
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

async fn index(
    State(state): State<Arc<AppState>>,
    remote_token: Option<Extension<RemotePageToken>>,
) -> Response {
    let mut response = text_response(
        "text/html; charset=utf-8",
        assets::render_index(
            assets::INDEX_HTML,
            remote_token
                .as_ref()
                .map_or(state.token.as_str(), |token| token.0.0.as_str()),
        ),
    );
    add_html_security_headers(&mut response);
    response
}

fn add_html_security_headers(response: &mut Response) {
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
}

async fn access_index() -> Response {
    let mut response = text_response(
        "text/html; charset=utf-8",
        super::monitor::assets::ACCESS_HTML.to_string(),
    );
    add_html_security_headers(&mut response);
    response
}

async fn access_js() -> Response {
    text_response(
        "text/javascript; charset=utf-8",
        String::from_utf8_lossy(super::monitor::assets::ACCESS_JS).into_owned(),
    )
}

async fn board_redirect() -> Response {
    (
        StatusCode::PERMANENT_REDIRECT,
        [(header::LOCATION, "/board/")],
    )
        .into_response()
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
pub(crate) fn parse_project_id(raw: &str) -> Result<ProjectId, AgboardError> {
    raw.parse()
}

/// The catalog: every project by name, without tasks. Read in one transaction.
async fn projects(State(state): State<Arc<AppState>>) -> Response {
    match with_files(&state, |files| files.catalog()).await {
        Ok(catalog) => json_response(StatusCode::OK, &catalog),
        Err(error) => agboard_error_response(&error),
    }
}

/// The project's index entry as its last good read, or the error of a defective
/// project. A project that is not in the index is `project_not_found`.
pub(crate) fn indexed_view(
    state: &AppState,
    id: &ProjectId,
) -> Result<Arc<crate::file_store::reader::ProjectSnapshot>, AgboardError> {
    indexed_view_in(&state.shared, &state.index, id)
}

pub(crate) fn indexed_view_in(
    shared: &std::path::Path,
    index: &std::sync::RwLock<crate::file_store::index::ProjectIndex>,
    id: &ProjectId,
) -> Result<Arc<crate::file_store::reader::ProjectSnapshot>, AgboardError> {
    // A folder that is gone is a deleted project, even before the watcher reloads.
    if !crate::file_store::layout::project_dir(shared, id).is_dir() {
        return Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        });
    }
    let index = index.read().unwrap_or_else(|e| e.into_inner());
    match index.entry(id) {
        None => Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        }),
        Some(ProjectEntry::Ready { view, .. }) => Ok(view.clone()),
        Some(ProjectEntry::Invalid { error, .. }) => Err(match error {
            AgboardError::FileInvalid {
                file,
                field,
                reason,
            } => AgboardError::FileInvalid {
                file: file.clone(),
                field: field.clone(),
                reason: reason.clone(),
            },
            other => AgboardError::FileError {
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
        Err(error) => return agboard_error_response(&error),
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
                tasks: Vec<&'a TaskView>,
                problems: &'a [crate::file_store::model::Problem],
            }
            let tasks = view
                .tasks
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
                    tasks,
                    problems: &view.problems,
                },
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn archive(State(state): State<Arc<AppState>>, Path(raw_project): Path<String>) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => json_response(
            StatusCode::OK,
            &serde_json::json!({
                "project": view.project,
                "version": view.version,
                "cursor": view.cursor,
                "tasks": view.tasks.iter().filter(|c| c.archived_at.is_some()).collect::<Vec<_>>(),
            }),
        ),
        Err(error) => agboard_error_response(&error),
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

async fn delete_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            format!("task {raw_id} not found."),
            "Task IDs are positive whole numbers.",
        );
    };
    match with_files(&state, move |store| {
        store.delete_archived_task(&project_id, id)
    })
    .await
    {
        Ok(()) => {
            refresh_index(&state);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn archive_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.archive_task(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

async fn restore_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.restore_task(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
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
        Err(error) => return agboard_error_response(&error),
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
                    "tasks": result.value.tasks,
                    "archivedCount": result.value.archived_count,
                }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

fn write_allowed(headers: &HeaderMap, context: &GuardContext) -> bool {
    write_refusal(headers, context).is_none()
}

/// Why a local write is refused, if it is. The checks run in the order of `check_delete`.
fn write_refusal(headers: &HeaderMap, context: &GuardContext) -> Option<guard::Denial> {
    let request = DeleteRequest {
        host: header_text(headers, "host"),
        origin: header_text(headers, "origin"),
        sec_fetch_site: header_text(headers, "sec-fetch-site"),
        token: header_text(headers, "x-agboard-token"),
    };
    guard::check_delete(&request, context.port, &context.token).err()
}

/// The page holds a token from an earlier server (the server was restarted). Its writes are refused with a
/// code of their own, so the page can ask the person to reload instead of retrying.
pub(crate) fn page_out_of_date() -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "page_out_of_date",
        "The server was restarted, so this page is out of date.",
        "Reload the page to load the current token. Changes made on this page are not saved.",
    )
}

pub(crate) fn remote_write_allowed(headers: &HeaderMap, remote: &RemoteGuard) -> bool {
    if [
        "forwarded",
        "x-forwarded-host",
        "x-original-host",
        "x-http-method-override",
        "x-method-override",
    ]
    .iter()
    .any(|name| headers.contains_key(*name))
    {
        return false;
    }
    let host = header_text(headers, "host");
    let origin = header_text(headers, "origin");
    let site = header_text(headers, "sec-fetch-site");
    let token = header_text(headers, "x-agboard-token");
    let Some(origin) = origin.and_then(canonical_https_origin) else {
        return false;
    };
    remote.origins.contains(&origin.0)
        && host
            .and_then(canonical_https_authority)
            .is_some_and(|host| host == origin.1)
        && site == Some("same-origin")
        && guard::token_matches(token, &remote.token)
}

pub(crate) fn canonical_https_origin(origin: &str) -> Option<(String, String)> {
    let (scheme, authority) = origin.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("https")
        || authority.is_empty()
        || authority.contains(['/', '?', '#', '@'])
    {
        return None;
    }
    let authority = canonical_https_authority(authority)?;
    Some((format!("https://{authority}"), authority))
}

pub(crate) fn canonical_https_authority(raw: &str) -> Option<String> {
    let authority = raw.parse::<axum::http::uri::Authority>().ok()?;
    if authority.as_str().contains('@') {
        return None;
    }
    let host = authority.host();
    if host.is_empty() {
        return None;
    }
    let port = authority.port_u16().unwrap_or(443);
    Some(if port == 443 {
        host.to_ascii_lowercase()
    } else {
        format!("{}:{port}", host.to_ascii_lowercase())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTaskInput {
    title: String,
    /// The whole TASK.md text, frontmatter included. Not combined with `body` or `acceptance`.
    #[serde(default)]
    description: Option<String>,
    /// The body without its frontmatter, and the conditions the server writes into it.
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    acceptance: Option<Vec<AcceptanceItem>>,
    assignee: Assignee,
    #[serde(default)]
    is_draft: bool,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveInput {
    task_status: Column,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    #[serde(default)]
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReorderInput {
    /// The task to put the moved task before; `null` puts it at the end of the lane.
    before_id: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditTaskInput {
    title: Option<String>,
    description: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    acceptance: Option<Vec<AcceptanceItem>>,
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
    #[serde(default)]
    reason: String,
    request_id: Option<String>,
    /// The choices of a pending request; `reason` is its question.
    #[serde(default)]
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnswerInput {
    pub(crate) request_id: String,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    /// The choice of the request to answer with. Absent for a note only.
    #[serde(default)]
    pub(crate) choice_id: Option<String>,
    /// The free-text note.
    #[serde(default)]
    pub(crate) text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MultipartMeta {
    request_id: String,
    #[serde(default)]
    finalize: bool,
    /// Only a new task takes it; an edit refuses it.
    #[serde(default)]
    is_draft: Option<bool>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    assignee: Option<Assignee>,
    #[serde(default)]
    remove_attachment_ids: Vec<String>,
    #[serde(default)]
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
    if files.len() > crate::domain::MAX_TASK_ATTACHMENTS {
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

async fn create_task(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<CreateTaskInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let description = match whole_text(
        input.description,
        input.body,
        input.acceptance,
        validate::task_template,
    ) {
        Ok(description) => description.unwrap_or_default(),
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| {
        store.create_task(
            &project_id,
            NewTask {
                title: input.title,
                description,
                assignee: input.assignee,
                actor: Actor::Human,
                is_draft: input.is_draft,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn move_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<MoveInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            "task not found.",
            "Task ID is invalid.",
        );
    };
    match with_files(&state, move |store| {
        store.move_work_task_for_user(
            &project_id,
            id,
            input.task_status,
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
                &serde_json::json!({"task": result.value, "changed": result.changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn reorder_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<ReorderInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            "task not found.",
            "Task ID is invalid.",
        );
    };
    match with_files(&state, move |store| {
        store.reorder_task(&project_id, id, input.before_id)
    })
    .await
    {
        Ok(result) => {
            if result.changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"task": result.value, "changed": result.changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn set_agent_status(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AgentStateInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            "task not found.",
            "Task ID is invalid.",
        );
    };
    match with_files(&state, move |store| {
        if input.agent_status == RunState::Pending {
            return store.request_decision(
                &project_id,
                id,
                Actor::Human,
                &input.reason,
                input.choices,
                chrono::Utc::now(),
            );
        }
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
                &serde_json::json!({"task": result.value, "changed": result.changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn answer_request(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AnswerInput>,
) -> Response {
    answer_project_task(state, raw_project, raw_id, input).await
}

/// Save one human answer through the shared FileStore path used by the local
/// board and the isolated monitor endpoint.
pub(crate) async fn answer_project_task(
    state: Arc<AppState>,
    raw_project: String,
    raw_id: String,
    input: AnswerInput,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            "task not found.",
            "Task ID is invalid.",
        );
    };
    match with_files(&state, move |store| {
        store.answer_request(
            &project_id,
            id,
            &input.request_id,
            Answer {
                actor: Actor::Human,
                choice_id: input.choice_id,
                text: input.text,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(task) => {
            refresh_index(&state);
            json_response(
                StatusCode::OK,
                &serde_json::json!({"task": task, "changed": true}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// A task ID from the URL; one that cannot be a task is `task_not_found`.
fn parse_task_id(raw: &str) -> Result<i64, Box<Response>> {
    raw.parse::<i64>().map_err(|_| {
        Box::new(error_response(
            StatusCode::NOT_FOUND,
            "task_not_found",
            "task not found.",
            "Task ID is invalid.",
        ))
    })
}

/// A task as `{"task": ...}`, telling the browsers only if something changed.
fn changed_task_response(
    state: &AppState,
    result: Result<Changed<TaskView>, AgboardError>,
) -> Response {
    match result {
        Ok(result) => {
            if result.changed {
                refresh_index(state);
            }
            json_response(StatusCode::OK, &serde_json::json!({"task": result.value}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// Save the title and description of a draft, and confirm it with `finalize`.
async fn edit_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<EditTaskInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    if input.title.is_none()
        && input.description.is_none()
        && input.body.is_none()
        && input.acceptance.is_none()
        && !input.finalize
    {
        return agboard_error_response(&AgboardError::InvalidArgument {
            message: "Nothing to change.".to_string(),
            command: None,
        });
    }
    let result = with_files(&state, move |store| {
        if input.body.is_some() || input.acceptance.is_some() {
            if input.description.is_some() {
                return Err(whole_or_parts());
            }
            store.edit_draft_task_parts(
                &project_id,
                id,
                input.title.as_deref(),
                TaskTextParts {
                    body: input.body.as_deref(),
                    acceptance: input.acceptance.as_deref(),
                },
                input.finalize,
                chrono::Utc::now(),
            )
        } else {
            store.edit_draft_task(
                &project_id,
                id,
                input.title.as_deref(),
                input.description.as_deref(),
                input.finalize,
                chrono::Utc::now(),
            )
        }
    })
    .await;
    changed_task_response(&state, result)
}

async fn edit_task_multipart(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
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
    if payload.meta.is_draft.is_some() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "isDraft is only accepted when a task is added.",
        );
    }
    let finalize = payload.meta.finalize;
    let title = payload.meta.title;
    let description = payload.meta.description;
    let removed = payload.meta.remove_attachment_ids;
    let additions = payload.additions;
    let attachments_changed = !removed.is_empty() || !additions.is_empty();
    let result = with_files(&state, move |store| {
        let now = chrono::Utc::now();
        // Images first, then the text and the draft flag.
        let owner = AttachmentOwner::Task(id);
        for attachment_id in &removed {
            store.delete_attachment_for_user(&project_id, &owner, attachment_id, now)?;
        }
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, now)?;
        }
        store.edit_draft_task(
            &project_id,
            id,
            title.as_deref(),
            description.as_deref(),
            finalize,
            now,
        )
    })
    .await;
    match result {
        Ok(Changed { value, changed }) => {
            let changed = changed || attachments_changed;
            if changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"task": value, "changed": changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn create_task_multipart(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
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
    let is_draft = payload.meta.is_draft.unwrap_or(false);
    if !payload.meta.remove_attachment_ids.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "A new task cannot remove attachments.",
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
    for input in &payload.additions {
        if let Err(error) = validate_attachment(&input.id, &input.name, &input.bytes) {
            return agboard_error_response(&error);
        }
    }
    let additions = payload.additions;
    let result = with_files(&state, move |store| {
        let now = chrono::Utc::now();
        let task = store.create_task(
            &project_id,
            NewTask {
                title,
                description,
                assignee,
                actor: Actor::Human,
                is_draft,
            },
            now,
        )?;
        let owner = AttachmentOwner::Task(task.id);
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, now)?;
        }
        store.task(&project_id, task.id)
    })
    .await;
    match result {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// Turn the draft flag of a task on or off.
async fn set_draft(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<DraftInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.set_draft(&project_id, id, input.is_draft, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

// ---------------------------------------------------------------- images and evidence

/// A stored file's bytes with the headers that stop a browser from sniffing them.
pub(crate) fn file_response(content_type: &str, bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CACHE_CONTROL, "no-store".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        bytes,
    )
        .into_response()
}

/// The bytes of a file the store has already checked the path of.
pub(crate) fn read_checked(
    store: &FileStore,
    path: &std::path::Path,
) -> Result<Vec<u8>, AgboardError> {
    let label = crate::file_store::layout::shared_label(store.shared_dir(), path);
    crate::file_store::io::read_bytes(path, &label)
}

fn invalid_multipart(reason: &str) -> Response {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_multipart",
        "request body is invalid.",
        reason,
    )
}

fn multipart_too_large() -> Response {
    error_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        "payload_too_large",
        "request body is invalid.",
        "Multipart bodies are limited to 52 MiB.",
    )
}

/// The one file of a text upload: its `file` part and the file name sent with it.
async fn parse_single_file(mut multipart: Multipart) -> Result<(String, Vec<u8>), Response> {
    let mut file = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid_multipart("The multipart body could not be read."))?
    {
        if field.name() != Some("file") {
            return Err(invalid_multipart(
                "The multipart body contains an unknown part.",
            ));
        }
        if file.is_some() {
            return Err(invalid_multipart("Send exactly one file part."));
        }
        let name = field.file_name().unwrap_or_default().to_owned();
        let bytes = field
            .bytes()
            .await
            .map_err(|_| invalid_multipart("The file part could not be read."))?;
        file = Some((name, bytes.to_vec()));
    }
    file.ok_or_else(|| invalid_multipart("A file part is required."))
}

/// The images of a task: the list, the registration, and the delivery of one of them.
/// The owner is checked with the project and the ID, so another task's image
/// is `attachment_not_found`.
async fn list_task_attachments(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    match with_files(&state, move |store| store.task(&project_id, id)).await {
        Ok(task) => json_response(
            StatusCode::OK,
            &serde_json::json!({"taskId": task.id, "attachments": task.attachments}),
        ),
        Err(error) => agboard_error_response(&error),
    }
}

async fn add_task_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let Ok(multipart) = multipart else {
        return multipart_too_large();
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
    if payload.additions.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "Send at least one image.",
        );
    }
    let additions = payload.additions;
    let result = with_files(&state, move |store| {
        let owner = AttachmentOwner::Task(id);
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, chrono::Utc::now())?;
        }
        store.task(&project_id, id)
    })
    .await;
    match result {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn get_task_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        let stored =
            store.attachment_path(&project_id, &AttachmentOwner::Task(id), &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok((media_type, bytes)) => file_response(&media_type, bytes),
        Err(error) => agboard_error_response(&error),
    }
}

async fn delete_task_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.delete_attachment_for_user(
            &project_id,
            &AttachmentOwner::Task(id),
            &attachment_id,
            chrono::Utc::now(),
        )?;
        store.task(&project_id, id)
    })
    .await;
    match result {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// Add a text evidence to a task. A person may do this on a draft.
async fn add_task_evidence(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let Ok(multipart) = multipart else {
        return multipart_too_large();
    };
    let (name, bytes) = match parse_single_file(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let result = with_files(&state, move |store| {
        store.add_evidence_for_user(&project_id, id, &name, &bytes, chrono::Utc::now())?;
        store.task(&project_id, id)
    })
    .await;
    match result {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// The text of a task's evidence, as plain text that a browser shows without sniffing.
async fn get_task_evidence(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id, evidence_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    match with_files(&state, move |store| {
        store.read_evidence(&project_id, id, &evidence_id)
    })
    .await
    {
        Ok(data) => file_response("text/plain; charset=utf-8", data.bytes),
        Err(error) => agboard_error_response(&error),
    }
}

async fn delete_task_evidence(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id, evidence_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let result = with_files(&state, move |store| {
        store.delete_evidence_for_user(&project_id, id, &evidence_id, chrono::Utc::now())?;
        store.task(&project_id, id)
    })
    .await;
    match result {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

// ---------------------------------------------------------------- epics

/// `epicId` of `PUT .../epic`: an EPIC-ID, or `null` to take the task out of
/// its epic. A missing field is `None` and is refused.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetEpicInput {
    #[serde(default, deserialize_with = "present_or_null")]
    epic_id: Option<Option<String>>,
}

fn present_or_null<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

/// Set or clear the epic of a task. A person may do this on any task, including
/// an archived one or a draft.
async fn set_task_epic(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<SetEpicInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let epic = match input.epic_id {
        None => {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "epicId is required (an EPIC-ID, or null).",
            );
        }
        Some(None) => None,
        Some(Some(raw)) => match raw.parse::<EpicId>() {
            Ok(id) => Some(id),
            Err(error) => return agboard_error_response(&error),
        },
    };
    let result = with_files(&state, move |store| {
        store.set_task_epic(
            &project_id,
            id,
            epic.as_ref(),
            Actor::Human,
            chrono::Utc::now(),
        )
    })
    .await;
    changed_task_response(&state, result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateEpicInput {
    id: String,
    name: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    is_draft: bool,
    /// The whole PLAN.md text, frontmatter included. Not combined with `body`.
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EpicPatchInput {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    is_draft: Option<bool>,
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    body: Option<String>,
    /// The task order of the epic. Replaces the stored order.
    #[serde(default)]
    priority: Option<Vec<i64>>,
}

/// The error for giving a whole file and its parts in one request.
fn whole_or_parts() -> AgboardError {
    AgboardError::InvalidValue {
        field: "body".into(),
        reason: "Give either the whole text or body fields, not both.".into(),
    }
}

/// The text of a file written from a body and conditions. A part that is not
/// given keeps what the file has now; the frontmatter's other keys stay.
fn compose_text(
    original: &str,
    current_body: &str,
    body: Option<String>,
    acceptance: Option<Vec<AcceptanceItem>>,
) -> Result<String, AgboardError> {
    let body = body.unwrap_or_else(|| current_body.to_string());
    frontmatter::compose(original, &body, acceptance.as_deref()).map_err(|defect| {
        AgboardError::InvalidValue {
            field: defect.field,
            reason: defect.reason,
        }
    })
}

/// The whole text for a new file: the given text, or one written from parts
/// over the template. `None` means the store writes its template.
fn whole_text(
    given: Option<String>,
    body: Option<String>,
    acceptance: Option<Vec<AcceptanceItem>>,
    template: impl FnOnce() -> String,
) -> Result<Option<String>, AgboardError> {
    if body.is_none() && acceptance.is_none() {
        return Ok(given);
    }
    if given.is_some() {
        return Err(whole_or_parts());
    }
    compose_text(&template(), "", body, acceptance).map(Some)
}

fn parse_epic_id(raw: &str) -> Result<EpicId, AgboardError> {
    raw.parse()
}

async fn list_epics(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => json_response(StatusCode::OK, &serde_json::json!({"epics": view.epics})),
        Err(error) => agboard_error_response(&error),
    }
}

async fn get_epic(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| store.epic(&project_id, &epic_id)).await {
        Ok(epic) => json_response(StatusCode::OK, &serde_json::json!({"epic": epic})),
        Err(error) => agboard_error_response(&error),
    }
}

async fn create_epic(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<CreateEpicInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let plan = match whole_text(input.plan, input.body, None, validate::plan_template) {
        Ok(plan) => plan,
        Err(error) => return agboard_error_response(&error),
    };
    let new = NewEpic {
        id: input.id,
        name: input.name,
        color: input.color,
        is_draft: input.is_draft,
        plan,
    };
    match with_files(&state, move |store| {
        store.create_epic(&project_id, new, chrono::Utc::now())
    })
    .await
    {
        Ok(epic) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"epic": epic}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn update_epic(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
    StrictJson(input): StrictJson<EpicPatchInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| {
        let priority = input.priority.clone();
        let plan = if input.body.is_some() {
            if input.plan.is_some() {
                return Err(whole_or_parts());
            }
            let current = store.epic(&project_id, &epic_id)?;
            Some(compose_text(
                &current.plan,
                &current.body,
                input.body,
                None,
            )?)
        } else {
            input.plan
        };
        let update = EpicUpdate {
            name: input.name,
            color: input.color,
            is_draft: input.is_draft,
            plan,
        };
        let now = chrono::Utc::now();
        let mut result = store.update_epic(&project_id, &epic_id, update, now)?;
        if let Some(order) = priority {
            let ordered = store.set_epic_priority(&project_id, &epic_id, &order, now)?;
            result = Changed {
                value: ordered.value,
                changed: result.changed || ordered.changed,
            };
        }
        Ok(result)
    })
    .await
    {
        Ok(Changed { value, changed }) => {
            if changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"epic": value, "changed": changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn list_epic_attachments(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| store.epic(&project_id, &epic_id)).await {
        Ok(epic) => json_response(
            StatusCode::OK,
            &serde_json::json!({"epicId": epic.id, "attachments": epic.attachments}),
        ),
        Err(error) => agboard_error_response(&error),
    }
}

async fn add_epic_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(multipart) = multipart else {
        return multipart_too_large();
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
    if payload.additions.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "Send at least one image.",
        );
    }
    let additions = payload.additions;
    let result = with_files(&state, move |store| {
        let owner = AttachmentOwner::Epic(epic_id.clone());
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, chrono::Utc::now())?;
        }
        store.epic(&project_id, &epic_id)
    })
    .await;
    match result {
        Ok(epic) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"epic": epic}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn get_epic_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_files(&state, move |store| {
        let stored =
            store.attachment_path(&project_id, &AttachmentOwner::Epic(epic_id), &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok((media_type, bytes)) => file_response(&media_type, bytes),
        Err(error) => agboard_error_response(&error),
    }
}

async fn delete_epic_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_files(&state, move |store| {
        store.delete_attachment_for_user(
            &project_id,
            &AttachmentOwner::Epic(epic_id.clone()),
            &attachment_id,
            chrono::Utc::now(),
        )?;
        store.epic(&project_id, &epic_id)
    })
    .await;
    match result {
        Ok(epic) => {
            refresh_index(&state);
            json_response(StatusCode::OK, &serde_json::json!({"epic": epic}))
        }
        Err(error) => agboard_error_response(&error),
    }
}
