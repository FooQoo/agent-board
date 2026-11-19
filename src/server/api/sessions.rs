//! `GET /api/projects/{id}/sessions`: the agent sessions attached to a project.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;

use crate::server::AppState;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::parse_project_id;

pub(super) async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    match parse_project_id(&raw_project) {
        Ok(project_id) => json_response(StatusCode::OK, &state.sessions.list(&project_id)),
        Err(error) => agboard_error_response(&error),
    }
}
