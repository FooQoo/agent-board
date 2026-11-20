//! The epic and task entries of the progress table.

use std::path::PathBuf;

use serde::Serialize;

use crate::domain::{Assignee, Column, RunState};

use super::Count;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEpic {
    pub id: String,
    pub name: String,
    pub document_path: PathBuf,
    /// The `priority` list of EPIC.md cannot be read; the tasks keep ID order.
    pub priority_error: bool,
    pub tasks: Vec<ProgressTask>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressTask {
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub task_status: Column,
    pub agent_status: RunState,
    pub draft: Option<crate::domain::Draft>,
    pub task_path: PathBuf,
    pub acceptance: Count,
    pub acceptance_error: bool,
    /// The waiting question, shortened. Only on a task waiting for a decision.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}
