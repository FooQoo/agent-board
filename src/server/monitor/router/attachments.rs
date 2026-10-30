//! The attachment files of a task or an epic, read through the checked store.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use super::MonitorState;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::AttachmentOwner;
use crate::file_store::validate::EpicId;
use crate::server::response::{agboard_error_response, file_response};
use crate::server::store::{parse_project_id, read_checked};

pub(super) async fn task_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let stored =
            store.attachment_path(&project_id, &AttachmentOwner::Task(id), &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => file_response(&mime, bytes),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

pub(super) async fn epic_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_epic, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match raw_epic.parse::<EpicId>() {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let owner = AttachmentOwner::Epic(epic_id);
        let stored = store.attachment_path(&project_id, &owner, &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => file_response(&mime, bytes),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}
