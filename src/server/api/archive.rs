//! Archiving tasks, restoring them, and deleting archived ones.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use super::{changed_task_response, parse_task_id};
use crate::server::AppState;
use crate::server::request::StrictJson;
use crate::server::response::{agboard_error_response, error_response, json_response};
use crate::server::store::{parse_project_id, refresh_index, with_files, with_request_files};

pub(super) async fn delete_task(
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

pub(super) async fn archive_task(
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
        store.archive_task(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

pub(super) async fn restore_task(
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
        store.restore_task(&project_id, id, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ArchiveDoneInput {
    ids: Vec<i64>,
}

pub(super) async fn archive_done(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    StrictJson(input): StrictJson<ArchiveDoneInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_request_files(&state, &headers, move |store| {
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
