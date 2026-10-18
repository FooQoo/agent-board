//! Epics: list, read, create, update, delete, and the text helpers that write
//! a file from its body and conditions.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::domain::Changed;
use crate::error::AgboardError;
use crate::file_store::frontmatter::{self, AcceptanceItem};
use crate::file_store::model::{EpicUpdate, NewEpic};
use crate::file_store::validate::{self, EpicId};
use crate::server::AppState;
use crate::server::request::{ApiJson, StrictJson};
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{indexed_view, parse_project_id, refresh_index, with_files};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateEpicInput {
    id: String,
    name: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    is_draft: bool,
    /// The whole PLAN.md text, frontmatter included. Not combined with `body`.
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EpicPatchInput {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    is_draft: Option<bool>,
    #[serde(default)]
    plan: Option<String>,
    #[serde(default)]
    body: Option<String>,
    /// The task order of the epic. Replaces the stored order.
    #[serde(default)]
    priority: Option<Vec<i64>>,
}

/// The error for giving a whole file and its parts in one request.
pub(super) fn whole_or_parts() -> AgboardError {
    AgboardError::InvalidValue {
        field: "body".into(),
        reason: "Give either the whole text or body fields, not both.".into(),
    }
}

/// The text of a file written from a body and conditions. A part that is not
/// given keeps what the file has now; the frontmatter's other keys stay.
pub(super) fn compose_text(
    original: &str,
    current_body: &str,
    body: Option<String>,
    acceptance: Option<Vec<AcceptanceItem>>,
) -> Result<String, AgboardError> {
    let body = body.unwrap_or_else(|| current_body.to_string());
    frontmatter::compose(original, &body, acceptance.as_deref()).map_err(|defect| {
        AgboardError::InvalidValue {
            field: defect.field,
            reason: defect.reason,
        }
    })
}

/// The whole text for a new file: the given text, or one written from parts
/// over the template. `None` means the store writes its template.
pub(super) fn whole_text(
    given: Option<String>,
    body: Option<String>,
    acceptance: Option<Vec<AcceptanceItem>>,
    template: impl FnOnce() -> String,
) -> Result<Option<String>, AgboardError> {
    if body.is_none() && acceptance.is_none() {
        return Ok(given);
    }
    if given.is_some() {
        return Err(whole_or_parts());
    }
    compose_text(&template(), "", body, acceptance).map(Some)
}

pub(super) fn parse_epic_id(raw: &str) -> Result<EpicId, AgboardError> {
    raw.parse()
}

pub(super) async fn list_epics(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view(&state, &project_id) {
        Ok(view) => json_response(StatusCode::OK, &serde_json::json!({"epics": view.epics})),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn get_epic(
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
    match with_files(&state, move |store| store.epic(&project_id, &epic_id)).await {
        Ok(epic) => json_response(StatusCode::OK, &serde_json::json!({"epic": epic})),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn create_epic(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<CreateEpicInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let plan = match whole_text(input.plan, input.body, None, validate::plan_template) {
        Ok(plan) => plan,
        Err(error) => return agboard_error_response(&error),
    };
    let new = NewEpic {
        id: input.id,
        name: input.name,
        color: input.color,
        is_draft: input.is_draft,
        plan,
    };
    match with_files(&state, move |store| {
        store.create_epic(&project_id, new, chrono::Utc::now())
    })
    .await
    {
        Ok(epic) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"epic": epic}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// Delete an epic. Refused with `epic_in_use` while any task, archived ones
/// included, names it; nothing is changed then.
pub(super) async fn delete_epic(
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
        store.delete_epic(&project_id, &epic_id)
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

pub(super) async fn update_epic(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
    StrictJson(input): StrictJson<EpicPatchInput>,
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
        let priority = input.priority.clone();
        let plan = if input.body.is_some() {
            if input.plan.is_some() {
                return Err(whole_or_parts());
            }
            let current = store.epic(&project_id, &epic_id)?;
            Some(compose_text(
                &current.plan,
                &current.body,
                input.body,
                None,
            )?)
        } else {
            input.plan
        };
        let update = EpicUpdate {
            name: input.name,
            color: input.color,
            is_draft: input.is_draft,
            plan,
        };
        let now = chrono::Utc::now();
        let mut result = store.update_epic(&project_id, &epic_id, update, now)?;
        if let Some(order) = priority {
            let ordered = store.set_epic_priority(&project_id, &epic_id, &order, now)?;
            result = Changed {
                value: ordered.value,
                changed: result.changed || ordered.changed,
            };
        }
        Ok(result)
    })
    .await
    {
        Ok(Changed { value, changed }) => {
            if changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"epic": value, "changed": changed}),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}
