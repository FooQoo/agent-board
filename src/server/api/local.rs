//! The routes that act on this PC itself, served by the local entrance only: the connection
//! settings, the notify call of local agents, opening a docs path, and the sessions the board
//! launches. The remote router leaves them out.

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post, put};

use super::docs::open_docs_path;
use super::sessions::{
    launch_session, session_log, session_models, set_autostart, stop_session, touch_session,
};
use super::{monitor_connections, notify};
use crate::server::AppState;

pub(super) fn routes() -> Router<Arc<AppState>> {
    monitor_connections::routes()
        .route("/api/notify", post(notify))
        .route(
            "/api/projects/{project_id}/sessions/touch",
            post(touch_session),
        )
        .route("/api/projects/{project_id}/docs/open", post(open_docs_path))
        .route(
            "/api/projects/{project_id}/sessions/models",
            get(session_models),
        )
        .route("/api/projects/{project_id}/sessions/log", get(session_log))
        .route(
            "/api/projects/{project_id}/sessions/launch",
            post(launch_session),
        )
        .route(
            "/api/projects/{project_id}/sessions/stop",
            post(stop_session),
        )
        .route(
            "/api/projects/{project_id}/sessions/autostart",
            put(set_autostart),
        )
}
