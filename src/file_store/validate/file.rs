//! Checks of the JSON files and the format version.

use std::collections::HashSet;

use serde_json::Value;

use super::body::normalize_answer_text;
use super::choice::choice_items_defect;
use super::{Defect, defect, is_hex32};
use crate::domain::{RunState, check_work_state, validate_project_name, validate_title};
use crate::error::AgboardError;
use crate::file_store::layout::FORMAT_NAME;
use crate::file_store::model::{Choice, HistoryRecord, ProjectFile, TaskFile, WorkspaceFile};

/// Accept the requested format version. A missing version is `file_invalid`;
/// any other version is `format_unsupported`. Nothing is converted.
pub fn check_format_version(value: &Value, file: &str) -> Result<(), AgboardError> {
    check_format_version_expected(value, file, 1)
}

/// Accept the versions of `task.json` and `epic.json`: 1, and 2 for a file that
/// uses the Backlog. Anything else is `format_unsupported`.
pub fn check_entity_format_version(value: &Value, file: &str) -> Result<(), AgboardError> {
    match value.get("formatVersion").and_then(Value::as_u64) {
        Some(1) | Some(2) => Ok(()),
        _ => check_format_version_expected(value, file, 2),
    }
}

pub fn check_format_version_expected(
    value: &Value,
    file: &str,
    expected: u32,
) -> Result<(), AgboardError> {
    match value.get("formatVersion") {
        None => Err(AgboardError::FileInvalid {
            file: file.to_string(),
            field: "formatVersion".into(),
            reason: "formatVersion is required.".into(),
        }),
        Some(version) if version.as_u64() == Some(u64::from(expected)) => Ok(()),
        Some(version) => Err(AgboardError::FormatUnsupported {
            file: file.to_string(),
            version: version.to_string(),
            expected,
        }),
    }
}

pub fn check_workspace(file: &WorkspaceFile) -> Vec<Defect> {
    if file.format == FORMAT_NAME {
        Vec::new()
    } else {
        vec![defect("format", "The format must be agboard-files.")]
    }
}

/// Defects of `project.json`. `folder_id` is the name of the project folder.
pub fn check_project(file: &ProjectFile, folder_id: &str) -> Vec<Defect> {
    let mut out = Vec::new();
    if file.id.as_str() != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_project_name(&file.name).ok().as_deref() != Some(file.name.as_str()) {
        out.push(defect(
            "name",
            "Project names must be 1 to 50 characters on one line.",
        ));
    }
    if file.next_task_id < 1 {
        out.push(defect("nextTaskId", "The next task ID starts at 1."));
    }
    out
}

/// Defects of `task.json`. `folder_id` is the task ID of the folder.
pub fn check_task(task: &TaskFile, folder_id: i64) -> Vec<Defect> {
    let mut out = check_task_metadata(task, folder_id);
    out.extend(check_history(&task.history));
    out
}

/// Defects of the task metadata independent of TASK.md history validity.
pub fn check_task_metadata(task: &TaskFile, folder_id: i64) -> Vec<Defect> {
    let mut out = Vec::new();
    if task.id != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_title(&task.title).ok().as_deref() != Some(task.title.as_str()) {
        out.push(defect(
            "title",
            "Titles must be 1 to 100 characters on one line.",
        ));
    }
    if task.position < 1 {
        out.push(defect("position", "Positions start at 1."));
    }
    if check_work_state(task.assignee, task.task_status, task.agent_status).is_err() {
        out.push(defect(
            "agentStatus",
            "Running needs an AI-owned task in Doing.",
        ));
    }
    if task.draft.is_some() && task.agent_status != RunState::Idle {
        out.push(defect("draft", "Only idle tasks can be drafts."));
    }
    let mut answer_ids = HashSet::new();
    for (index, answer) in task.request_answers.iter().enumerate() {
        let field = |name: &str| format!("requestAnswers[{index}].{name}");
        if !is_hex32(&answer.request_id) || !answer_ids.insert(&answer.request_id) {
            out.push(defect(
                field("requestId"),
                "Answer request IDs must be valid, unique, and already resolved.",
            ));
        }
        if answer.choice_id.is_some() != answer.choice_label.is_some() {
            out.push(defect(
                field("choiceLabel"),
                "A selected choice needs its ID and label.",
            ));
        }
        if let (Some(id), Some(label)) = (&answer.choice_id, &answer.choice_label)
            && let Some(d) = choice_items_defect(&[Choice {
                id: id.clone(),
                label: label.clone(),
            }])
        {
            out.push(defect(field(&d.field), d.reason));
        }

        if answer
            .text
            .as_deref()
            .is_some_and(|text| normalize_answer_text(text).ok().flatten().as_deref() != Some(text))
        {
            out.push(defect(
                field("text"),
                "Answer text must be nonblank and within its limit.",
            ));
        }
        if answer.choice_id.is_none() && answer.text.is_none() {
            out.push(defect(field("text"), "An answer needs a choice or text."));
        }
    }
    if task.archived_at.is_some() && task.agent_status != RunState::Idle {
        out.push(defect("archivedAt", "An archived task is idle."));
    }
    out
}

pub fn check_history(events: &[HistoryRecord]) -> Vec<Defect> {
    events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            crate::domain::validate_work_reason(&event.reason)
                .err()
                .map(|error| defect(format!("history[{index}].reason"), error.reason()))
        })
        .collect()
}
