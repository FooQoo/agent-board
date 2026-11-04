//! A person checking or unchecking one acceptance condition, from the board
//! or the mobile monitor. No version is sent: the person's choice is saved
//! over the latest file (see `FileStore::set_acceptance_done`).

use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::AppState;
use super::response::{agboard_error_response, error_response, json_response};
use super::store::{parse_project_id, refresh_index, with_request_files};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AcceptanceInput {
    done: bool,
}

/// Sets condition `condition` of task `raw_id` to `input.done` and answers
/// `{task, changed}`.
pub(crate) async fn set_project_task_acceptance(
    headers: HeaderMap,
    state: Arc<AppState>,
    (raw_project, raw_id, condition): (String, String, String),
    input: AcceptanceInput,
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
    let result = with_request_files(&state, &headers, move |store| {
        store.set_acceptance_done(&project_id, id, &condition, input.done, chrono::Utc::now())
    })
    .await;
    match result {
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
