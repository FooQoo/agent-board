//! `nextTasks`: the ready AI tasks to pick up next.

use std::path::PathBuf;

use serde::Serialize;

use crate::domain::{Assignee, Column, RunState};
use crate::file_store::layout;
use crate::file_store::model::TaskView;

/// How many tasks `nextTasks` holds at most.
pub const MAX_NEXT_TASKS: usize = 3;

/// Why a task is in `nextTasks`. The values are stable; agents may rely on them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NextReason {
    /// In Doing with an Idle run state: stalled work to resume.
    Resume,
    /// In Todo with an Idle run state: the next ready task in its epic's order.
    NextInEpic,
}

/// A task recommended as the next work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextTask {
    pub id: i64,
    pub title: String,
    /// `null` when the task has no epic.
    pub epic_id: Option<String>,
    pub task_path: PathBuf,
    pub why: NextReason,
}

/// Ready AI tasks, resume work before Todo work, each in table order. Dependencies
/// between tasks are prose in EPIC.md and are not evaluated here.
pub(super) fn next_tasks(listed: &[&TaskView], project_dir: &std::path::Path) -> Vec<NextTask> {
    let ready = |task: &&&TaskView| {
        task.assignee == Assignee::Ai
            && task.agent_status == RunState::Idle
            && task.draft.is_none()
            && task.archived_at.is_none()
    };
    let pick = |column: Column, why: NextReason| {
        listed
            .iter()
            .filter(ready)
            .filter(move |task| task.task_status == column)
            .map(move |task| (*task, why))
            .collect::<Vec<_>>()
    };
    pick(Column::Doing, NextReason::Resume)
        .into_iter()
        .chain(pick(Column::Todo, NextReason::NextInEpic))
        .take(MAX_NEXT_TASKS)
        .map(|(task, why)| NextTask {
            id: task.id,
            title: task.title.clone(),
            epic_id: task.epic_id.clone(),
            task_path: layout::task_md(&layout::task_dir(project_dir, task.id)),
            why,
        })
        .collect()
}
