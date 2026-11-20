//! The periodic summaries of a project: list and dismiss (see `file_store::notify`). The write
//! guard in `api` checks the change first. The files change on disk, and the watcher announces it
//! as a change of the project's messages, so no reload is queued here.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;

use crate::server::AppState;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{parse_project_id, with_files};

/// `GET …/summaries`: newest first. Dismissed summaries are left out unless the query has
/// `dismissed=include`.
pub(super) async fn list_summaries(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let project = match parse_project_id(&project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let include_dismissed = query.get("dismissed").is_some_and(|v| v == "include");
    match with_files(&state, move |store| store.summaries(&project)).await {
        Ok(mut summaries) => {
            if !include_dismissed {
                summaries.retain(|s| !s.dismissed);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({ "summaries": summaries }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// `POST …/summaries/{id}/dismiss`: sets `dismissed` on the summary's line. The line stays.
pub(super) async fn dismiss_summary(
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
) -> Response {
    let project = match parse_project_id(&project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| store.dismiss_summary(&project, &id)).await {
        Ok(summary) => json_response(StatusCode::OK, &serde_json::json!({ "summary": summary })),
        Err(error) => agboard_error_response(&error),
    }
}
