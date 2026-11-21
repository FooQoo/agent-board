//! Sending a plan from the Backlog to Todo: one card, or the cards of an epic. Only a person
//! sends, so the actor is always the person.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::epics::parse_epic_id;
use super::parse_task_id;
use crate::domain::Actor;
use crate::server::AppState;
use crate::server::request::StrictJson;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{parse_project_id, refresh_index, with_request_files};

/// `ack` confirms the warning about an open question.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SendTaskInput {
    #[serde(default)]
    ack: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SendEpicInput {
    /// Only these cards; all the Backlog cards of the epic when absent.
    #[serde(default)]
    task_ids: Option<Vec<i64>>,
    #[serde(default)]
    ack: bool,
}

/// Send one Backlog card to Todo.
pub(super) async fn send_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<SendTaskInput>,
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
        store.send_task(&project_id, id, Actor::Human, input.ack, chrono::Utc::now())
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

/// Send the Backlog cards of an epic to Todo in one save.
pub(super) async fn send_epic(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
    StrictJson(input): StrictJson<SendEpicInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match parse_epic_id(&raw_epic) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.send_epic(
            &project_id,
            &epic_id,
            input.task_ids.as_deref(),
            Actor::Human,
            input.ack,
            chrono::Utc::now(),
        )
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
                    "epic": result.value.epic,
                    "sent": result.value.sent,
                    "changed": result.changed,
                }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}
