//! Editing a task: the text of a draft, the draft flag, and the task's epic.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::{Deserialize, Deserializer};

use super::epics::whole_or_parts;
use super::{changed_task_response, parse_task_id};
use crate::domain::{Actor, Draft};
use crate::error::AgboardError;
use crate::file_store::TaskTextParts;
use crate::file_store::frontmatter::AcceptanceItem;
use crate::file_store::validate::EpicId;
use crate::server::AppState;
use crate::server::request::StrictJson;
use crate::server::response::{agboard_error_response, error_response};
use crate::server::store::{parse_project_id, with_request_files};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditTaskInput {
    title: Option<String>,
    description: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    acceptance: Option<Vec<AcceptanceItem>>,
    #[serde(default)]
    finalize: bool,
    /// `"ai"` leaves the task an AI draft after the save: a person's edit of an AI
    /// proposal goes back to the proposal instead of being finalized.
    #[serde(default)]
    draft: Option<Draft>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DraftInput {
    /// `"human"` makes the task a person's draft, `null` finalizes it, and `"ai"`
    /// gives it back to the AI draft it was.
    #[serde(default, deserialize_with = "super::epics::present_draft")]
    draft: Option<Option<Draft>>,
    /// Leaving the draft discards its changes instead of confirming them.
    #[serde(default)]
    discard: bool,
}

/// Save the title and description of a draft, and confirm it with `finalize`.
pub(super) async fn edit_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<EditTaskInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    if input.title.is_none()
        && input.description.is_none()
        && input.body.is_none()
        && input.acceptance.is_none()
        && !input.finalize
        && input.draft.is_none()
    {
        return agboard_error_response(&AgboardError::InvalidArgument {
            message: "Nothing to change.".to_string(),
            command: None,
        });
    }
    let finalize = finalize_target(input.finalize, input.draft);
    let result = with_request_files(&state, &headers, move |store| {
        if input.body.is_some() || input.acceptance.is_some() {
            if input.description.is_some() {
                return Err(whole_or_parts());
            }
            store.edit_draft_task_parts_to(
                &project_id,
                id,
                input.title.as_deref(),
                TaskTextParts {
                    body: input.body.as_deref(),
                    acceptance: input.acceptance.as_deref(),
                },
                finalize,
                chrono::Utc::now(),
            )
        } else {
            store.edit_draft_task_to(
                &project_id,
                id,
                input.title.as_deref(),
                input.description.as_deref(),
                finalize,
                chrono::Utc::now(),
            )
        }
    })
    .await;
    changed_task_response(&state, result)
}

/// Turn the draft flag of a task on or off.
pub(super) async fn set_draft(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<DraftInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let Some(draft) = input.draft else {
        return error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "draft is required (\"human\", \"ai\", or null).",
        );
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.set_draft(&project_id, id, draft, input.discard, chrono::Utc::now())
    })
    .await;
    changed_task_response(&state, result)
}

/// `epicId` of `PUT .../epic`: an EPIC-ID, or `null` to take the task out of
/// its epic. A missing field is `None` and is refused.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SetEpicInput {
    #[serde(default, deserialize_with = "present_or_null")]
    epic_id: Option<Option<String>>,
}

pub(super) fn present_or_null<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

/// Set or clear the epic of a task. A person may do this on any task, including
/// an archived one or a draft.
pub(super) async fn set_task_epic(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    StrictJson(input): StrictJson<SetEpicInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let id = match parse_task_id(&raw_id) {
        Ok(id) => id,
        Err(response) => return *response,
    };
    let epic = match input.epic_id {
        None => {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "epicId is required (an EPIC-ID, or null).",
            );
        }
        Some(None) => None,
        Some(Some(raw)) => match raw.parse::<EpicId>() {
            Ok(id) => Some(id),
            Err(error) => return agboard_error_response(&error),
        },
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.set_task_epic(
            &project_id,
            id,
            epic.as_ref(),
            Actor::Human,
            chrono::Utc::now(),
        )
    })
    .await;
    changed_task_response(&state, result)
}

/// What a saved edit does to the draft: nothing, clear it, or end as an AI draft.
pub(super) fn finalize_target(finalize: bool, draft: Option<Draft>) -> Option<Option<Draft>> {
    match (finalize, draft) {
        (_, Some(owner)) => Some(Some(owner)),
        (true, None) => Some(None),
        (false, None) => None,
    }
}
