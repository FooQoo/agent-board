//! Creating and editing a task together with its images in one multipart request.

use std::sync::Arc;

use axum::extract::{Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use super::multipart::parse_multipart;
use super::parse_task_id;
use crate::domain::{Actor, Changed, NewTask, validate_attachment};
use crate::file_store::model::AttachmentOwner;
use crate::file_store::model::SimpleRequestInput;
use crate::server::AppState;
use crate::server::response::{agboard_error_response, error_response, json_response};
use crate::server::store::{parse_project_id, refresh_index, with_request_files};

pub(super) async fn edit_task_multipart(
    headers: HeaderMap,
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
    let multipart = match multipart {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Multipart bodies are limited to 52 MiB.",
            );
        }
    };
    let payload = match parse_multipart(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if payload.meta.request_kind.is_some() || payload.meta.epic_id.is_some() {
        return super::multipart::invalid_multipart(
            "requestKind and epicId are only accepted when creating a simple request.",
        );
    }
    if payload.meta.request_id.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "requestId is required.",
        );
    }
    if payload.meta.is_draft.is_some() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "isDraft is only accepted when a task is added.",
        );
    }
    let finalize = payload.meta.finalize;
    let title = payload.meta.title;
    let description = payload.meta.description;
    let removed = payload.meta.remove_attachment_ids;
    let additions = payload.additions;
    let attachments_changed = !removed.is_empty() || !additions.is_empty();
    let result = with_request_files(&state, &headers, move |store| {
        let now = chrono::Utc::now();
        // Images first, then the text and the draft flag.
        let owner = AttachmentOwner::Task(id);
        for attachment_id in &removed {
            store.delete_attachment_for_user(&project_id, &owner, attachment_id, now)?;
        }
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, now)?;
        }
        store.edit_draft_task(
            &project_id,
            id,
            title.as_deref(),
            description.as_deref(),
            finalize,
            now,
        )
    })
    .await;
    match result {
        Ok(Changed { value, changed }) => {
            let changed = changed || attachments_changed;
            if changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"task": value, "changed": changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn create_task_multipart(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let multipart = match multipart {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Multipart bodies are limited to 52 MiB.",
            );
        }
    };
    let payload = match parse_multipart(multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    if payload.meta.request_kind.as_deref() == Some("simple") {
        if payload.meta.title.is_some()
            || payload.meta.assignee.is_some()
            || payload.meta.is_draft.is_some()
            || payload.meta.finalize
            || !payload.meta.remove_attachment_ids.is_empty()
        {
            return super::multipart::invalid_multipart(
                "A simple request accepts description, optional epicId, images, and requestId only.",
            );
        }
        let Some(description) = payload.meta.description else {
            return super::multipart::invalid_multipart(
                "A simple request description is required.",
            );
        };
        let Some(first_line) = description.lines().find(|line| !line.trim().is_empty()) else {
            return super::multipart::invalid_multipart(
                "A simple request description is required.",
            );
        };
        let title: String = first_line.trim().chars().take(120).collect();
        let request_id = payload.meta.request_id;
        let epic_id = payload.meta.epic_id;
        let additions = payload.additions;
        let result = with_request_files(&state, &headers, move |store| {
            store.create_simple_request(
                &project_id,
                SimpleRequestInput {
                    title,
                    body: description,
                    epic_id,
                    request_id,
                    images: additions,
                },
                chrono::Utc::now(),
            )
        })
        .await;
        return match result {
            Ok((task, created)) => {
                if created {
                    refresh_index(&state);
                }
                json_response(
                    if created {
                        StatusCode::CREATED
                    } else {
                        StatusCode::OK
                    },
                    &serde_json::json!({"task": task, "replayed": !created}),
                )
            }
            Err(error) => agboard_error_response(&error),
        };
    }
    if payload.meta.request_kind.is_some() || payload.meta.epic_id.is_some() {
        return super::multipart::invalid_multipart(
            "requestKind and epicId are only accepted for simple requests.",
        );
    }
    let Some(title) = payload.meta.title else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "title is required.",
        );
    };
    let Some(description) = payload.meta.description else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "description is required.",
        );
    };
    let Some(assignee) = payload.meta.assignee else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "assignee is required.",
        );
    };
    let is_draft = payload.meta.is_draft.unwrap_or(false);
    if !payload.meta.remove_attachment_ids.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "A new task cannot remove attachments.",
        );
    }
    let request_id = payload.meta.request_id;
    if request_id.is_empty() {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "requestId is required.",
        );
    }
    for input in &payload.additions {
        if let Err(error) = validate_attachment(&input.id, &input.name, &input.bytes) {
            return agboard_error_response(&error);
        }
    }
    let additions = payload.additions;
    let result = with_request_files(&state, &headers, move |store| {
        let now = chrono::Utc::now();
        let task = store.create_task(
            &project_id,
            NewTask {
                title,
                description,
                assignee,
                actor: Actor::Human,
                is_draft,
            },
            now,
        )?;
        let owner = AttachmentOwner::Task(task.id);
        for input in additions {
            store.add_attachment_for_user(&project_id, &owner, input, now)?;
        }
        store.task(&project_id, task.id)
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
