//! A person starts AI drafts: one task, or an epic with its AI-draft tasks.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use super::epics::parse_epic_id;
use super::{changed_task_response, parse_task_id};
use crate::domain::Actor;
use crate::server::AppState;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{parse_project_id, refresh_index, with_files, with_request_files};

/// A person starts one task: its AI draft is cleared.
pub(super) async fn start_task(
    headers: HeaderMap,
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
    let result = with_request_files(&state, &headers, move |store| {
        store.start_task(&project_id, id, Actor::Human, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

/// Start an epic: it and all its AI-draft tasks leave the draft together.
pub(super) async fn start_epic(
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
    match with_files(&state, move |store| {
        store.start_epic(&project_id, &epic_id, Actor::Human, chrono::Utc::now())
    })
    .await
    {
        Ok(result) => {
            if result.changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({
                    "epic": result.value.epic,
                    "started": result.value.started,
                    "changed": result.changed,
                }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}
