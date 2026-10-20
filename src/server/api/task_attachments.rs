//! The images of a task. The owner is checked with the
//! project and the ID, so another task's file is not found.

use std::sync::Arc;

use axum::extract::{Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::Response;

use super::multipart::{multipart_too_large, parse_multipart};
use super::parse_task_id;
use crate::file_store::model::AttachmentOwner;
use crate::server::AppState;
use crate::server::response::{
    agboard_error_response, error_response, file_response, json_response,
};
use crate::server::store::{parse_project_id, read_checked, refresh_index, with_files};

/// The owner is checked with the project and the ID, so another task's image
/// is `attachment_not_found`.
pub(super) async fn list_task_attachments(
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
pub(super) async fn add_task_attachment(
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
pub(super) async fn get_task_attachment(
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

pub(super) async fn delete_task_attachment(
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
