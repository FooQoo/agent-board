//! `nextTasks`: the ready AI tasks to pick up next.

use std::path::PathBuf;

use serde::Serialize;

use crate::domain::{Assignee, Column, RunState};
use crate::file_store::layout;
use crate::file_store::model::TaskView;
use crate::file_store::reader::ProjectSnapshot;

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

/// A Todo task of an epic that orders its tasks in waves is held back while a task
/// of an earlier wave is not Done. Archived tasks are ignored, tasks that no wave
/// lists are never held back, and an unreadable order gates nothing.
pub(crate) fn gated_by_waves(task: &TaskView, snapshot: &ProjectSnapshot) -> bool {
    let Some(epic) = task
        .epic_id
        .as_deref()
        .and_then(|id| snapshot.epics.iter().find(|epic| epic.id.as_str() == id))
    else {
        return false;
    };
    let Some(position) = epic.waves.iter().position(|wave| wave.contains(&task.id)) else {
        return false;
    };
    let earlier: Vec<i64> = epic.waves[..position].iter().flatten().copied().collect();
    snapshot.tasks.iter().any(|other| {
        earlier.contains(&other.id)
            && other.archived_at.is_none()
            && other.task_status != Column::Done
    })
}

/// Ready AI tasks, resume work before Todo work, each in table order. A Todo task
/// waits for the earlier waves of its epic; other dependencies between tasks are
/// prose in EPIC.md and are not evaluated here.
pub(super) fn next_tasks(
    listed: &[&TaskView],
    snapshot: &ProjectSnapshot,
    project_dir: &std::path::Path,
) -> Vec<NextTask> {
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
            .filter(move |task| column != Column::Todo || !gated_by_waves(task, snapshot))
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
