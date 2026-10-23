//! The board router: its routes, the Host guard and the write guard. The
//! handlers live in the submodules, grouped as the routes are.

mod archive;
mod docs;
mod detail;
mod epic_attachments;
mod epics;
mod monitor_connections;
mod multipart;
mod onboarding;
mod pages;
mod preferences;
mod projects;
mod summary;
mod task_attachments;
mod task_edit;
mod task_multipart;
mod tasks;

use std::sync::Arc;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{delete, get, patch, post, put};

pub(crate) use detail::{Target, detail_response};

use super::guard::{self, header_text};
use super::response::{
    agboard_error_response, error_response, forbidden, json_response, page_out_of_date,
};
use super::store::refresh_index;
use super::{AppState, events};
use crate::domain::Changed;
use crate::error::AgboardError;
use crate::file_store::model::TaskView;
use archive::*;
use docs::*;
use detail::{epic_detail, task_detail};
use epic_attachments::*;
use epics::*;
use monitor_connections::*;
use onboarding::*;
use pages::*;
use preferences::*;
use projects::*;
use summary::summary;
use task_attachments::*;
use task_edit::*;
use task_multipart::*;
use tasks::*;

const MAX_MULTIPART_BODY: usize = 52 * 1024 * 1024;

#[derive(Clone)]
struct GuardContext {
    port: u16,
    token: String,
}

pub(crate) fn router(state: Arc<AppState>) -> Router {
    let guard_context = GuardContext {
        port: state.port,
        token: state.token.clone(),
    };
    Router::new()
        .route("/", get(index))
        .route("/assets/{name}", get(asset))
        .route("/logo.png", get(logo_png))
        .route("/logo-white.png", get(logo_white_png))
        .route("/api/events", get(events::events))
        .route("/api/projects", get(projects))
        .route("/api/projects/{project_id}/archive", get(archive))
        .route("/api/projects/{project_id}/summary", get(summary))
        .route(
            "/api/projects/{project_id}/tasks/{id}/detail",
            get(task_detail),
        )
        .route(
            "/api/projects/{project_id}/epics/{epic_id}/detail",
            get(epic_detail),
        )
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
            "/api/projects/{project_id}/tasks/{id}/epic",
            put(set_task_epic),
        )
        .route(
            "/api/projects/{project_id}/epics",
            get(list_epics).post(create_epic),
        )
        .route(
            "/api/projects/{project_id}/epics/{epic_id}",
            get(get_epic).patch(update_epic).delete(delete_epic),
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
        )
        .route("/api/monitor-connections", get(get_connections))
        .route(
            "/api/monitor-connections/settings/ngrok",
            put(put_ngrok_settings),
        )
        .route(
            "/api/monitor-connections/transports/ngrok/start",
            post(start_ngrok),
        )
        .route(
            "/api/monitor-connections/transports/ngrok/stop",
            post(stop_ngrok),
        )
        .route("/api/monitor-connections/token", delete(delete_saved_token))
        .route("/api/notify", post(notify))
        .route("/api/onboarding", get(get_onboarding))
        .route("/api/onboarding/claim", post(claim_onboarding))
        .route("/api/onboarding/replay", post(replay_onboarding))
        .route("/api/onboarding/heartbeat", post(heartbeat_onboarding))
        .route("/api/onboarding/skip", post(skip_onboarding))
        .route("/api/onboarding/recover", post(recover_onboarding))
        .route(
            "/api/projects/{project_id}/onboarding/start",
            post(start_onboarding),
        )
        .route(
            "/api/projects/{project_id}/onboarding/{run_id}/advance",
            post(advance_onboarding),
        )
        .route(
            "/api/projects/{project_id}/onboarding/{run_id}/finish",
            post(finish_onboarding),
        )
        .route(
            "/api/projects/{project_id}/onboarding/{run_id}/abort",
            post(abort_onboarding),
        )
        .route("/api/projects/{project_id}/docs/tree", get(get_docs_tree))
        .route(
            "/api/projects/{project_id}/docs/file",
            get(get_docs_file).put(put_docs_file),
        )
        .route(
            "/api/projects/{project_id}/docs/assets",
            get(get_docs_asset),
        )
        .route("/api/health", get(health))
        .route(
            "/api/preferences",
            get(get_preferences).put(put_preferences),
        )
        .layer(DefaultBodyLimit::max(MAX_MULTIPART_BODY))
        .layer(middleware::from_fn_with_state(
            guard_context.clone(),
            write_guard,
        ))
        .layer(middleware::from_fn_with_state(guard_context, host_guard))
        .layer(middleware::from_fn(no_referrer))
        .with_state(state)
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
    if guard::host_allowed(host, context.port) {
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
    let allowed = guard::write_allowed(request.headers(), context.port, &context.token);
    if reads || request.uri().path() == "/api/notify" || allowed {
        next.run(request).await
    } else if request.headers().contains_key("x-agboard-token")
        && matches!(
            guard::write_refusal(request.headers(), context.port, &context.token),
            Some(guard::Denial::Token)
        )
    {
        page_out_of_date()
    } else {
        forbidden("Changes can only be made from the board page.")
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
