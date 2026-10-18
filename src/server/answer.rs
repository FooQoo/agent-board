//! Answering a pending decision request. The local board and the remote
//! monitor's write endpoint both save answers through here.

use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::AppState;
use super::response::{agboard_error_response, error_response, json_response};
use super::store::{parse_project_id, refresh_index, with_request_files};
use crate::domain::Actor;
use crate::file_store::Answer;

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

/// Save one human answer through the shared FileStore path used by the local
/// board and the isolated monitor endpoint.
pub(crate) async fn answer_project_task(
    headers: HeaderMap,
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
    match with_request_files(&state, &headers, move |store| {
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
