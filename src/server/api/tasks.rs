//! Task routes: create, move, reorder, the run state, and answers.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::epics::whole_text;
use crate::domain::{Actor, Assignee, ChangeContext, Column, NewTask, RunState};
use crate::error::AgboardError;
use crate::file_store::frontmatter::AcceptanceItem;
use crate::file_store::model::Choice;
use crate::file_store::validate::{self};
use crate::server::AppState;
use crate::server::answer::{AnswerInput, answer_project_task};
use crate::server::request::ApiJson;
use crate::server::response::{agboard_error_response, error_response, json_response};
use crate::server::store::{parse_project_id, refresh_index, with_files, with_request_files};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateTaskInput {
    title: String,
    /// The whole TASK.md text, frontmatter included. Not combined with `body` or `acceptance`.
    #[serde(default)]
    description: Option<String>,
    /// The body without its frontmatter, and the conditions the server writes into it.
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    acceptance: Option<Vec<AcceptanceItem>>,
    assignee: Assignee,
    #[serde(default)]
    is_draft: bool,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MoveInput {
    task_status: Column,
    /// The status the page showed when the user chose the move. When given, a task that has
    /// moved on since is refused with `task_status_changed` and nothing is written.
    #[serde(default)]
    from_status: Option<Column>,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    #[serde(default)]
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReorderInput {
    /// The task to put the moved task before; `null` puts it at the end of the lane.
    before_id: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AgentStateInput {
    agent_status: RunState,
    #[serde(rename = "actor", default)]
    _actor: Option<serde_json::Value>,
    #[serde(default)]
    reason: String,
    request_id: Option<String>,
    /// The choices of a pending request; `reason` is its question.
    #[serde(default)]
    choices: Vec<Choice>,
}

pub(super) async fn create_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    ApiJson(input): ApiJson<CreateTaskInput>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let description = match whole_text(
        input.description,
        input.body,
        input.acceptance,
        validate::task_template,
    ) {
        Ok(description) => description.unwrap_or_default(),
        Err(error) => return agboard_error_response(&error),
    };
    match with_request_files(&state, &headers, move |store| {
        store.create_task(
            &project_id,
            NewTask {
                title: input.title,
                description,
                assignee: input.assignee,
                actor: Actor::Human,
                is_draft: input.is_draft,
            },
            chrono::Utc::now(),
        )
    })
    .await
    {
        Ok(task) => {
            refresh_index(&state);
            json_response(StatusCode::CREATED, &serde_json::json!({"task": task}))
        }
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn move_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<MoveInput>,
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
        let ctx = ChangeContext {
            actor: Actor::Human,
            reason: input.reason,
        };
        match input.from_status {
            Some(from) => store.move_work_task_for_user_from(
                &project_id,
                id,
                from,
                input.task_status,
                ctx,
                chrono::Utc::now(),
            ),
            None => store.move_work_task_for_user(
                &project_id,
                id,
                input.task_status,
                ctx,
                chrono::Utc::now(),
            ),
        }
    })
    .await
    {
        Ok(result) => {
            if result.changed {
                refresh_index(&state);
            }
            json_response(
                StatusCode::OK,
                &serde_json::json!({"task": result.value, "changed": result.changed}),
            )
        }
        // The page names the status the task has now, so it can show it without reading again.
        Err(error @ AgboardError::TaskStatusChanged { current, .. }) => json_response(
            StatusCode::CONFLICT,
            &serde_json::json!({
                "error": {
                    "code": error.code(),
                    "message": error.message(),
                    "reason": error.reason(),
                },
                "currentStatus": current,
            }),
        ),
        Err(error) => agboard_error_response(&error),
    }
}

pub(super) async fn reorder_task(
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<ReorderInput>,
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
    match with_files(&state, move |store| {
        store.reorder_task(&project_id, id, input.before_id)
    })
    .await
    {
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

pub(super) async fn set_agent_status(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AgentStateInput>,
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
        if input.agent_status == RunState::Pending {
            return store.request_decision(
                &project_id,
                id,
                Actor::Human,
                &input.reason,
                input.choices,
                chrono::Utc::now(),
            );
        }
        store.set_agent_status(
            &project_id,
            id,
            input.agent_status,
            ChangeContext {
                actor: Actor::Human,
                reason: input.reason,
            },
            input.request_id.as_deref(),
            chrono::Utc::now(),
        )
    })
    .await
    {
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

pub(super) async fn answer_request(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((raw_project, raw_id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AnswerInput>,
) -> Response {
    answer_project_task(headers, state, raw_project, raw_id, input).await
}
