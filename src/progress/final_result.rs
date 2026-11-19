//! `finalResultMissing`: AI tasks whose acceptance conditions are all met but that have no
//! final result. The agent records one with `result add --final`; that clears the entry.

use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::domain::{Assignee, Column, ResultKind};
use crate::file_store::layout;
use crate::file_store::model::TaskView;
use crate::file_store::onboarding_model::is_onboarding_sample;
use crate::file_store::reader::ProjectSnapshot;

/// How many tasks `finalResultMissing` holds at most.
const MAX_FINAL_RESULT_MISSING: usize = 5;

/// How long after automatic Done a task is still listed, in hours.
const FINAL_RESULT_WINDOW_HOURS: i64 = 24;

/// A task that needs a final result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalResultMissing {
    pub id: i64,
    pub title: String,
    pub task_path: PathBuf,
}

/// Unarchived, non-draft AI tasks with at least one condition, all of them done, and no final
/// result: still in Todo or Doing, or moved to Done within the last
/// [`FINAL_RESULT_WINDOW_HOURS`] hours. In ID order, at most [`MAX_FINAL_RESULT_MISSING`].
pub fn final_result_missing(
    snapshot: &ProjectSnapshot,
    project_dir: &std::path::Path,
    now: DateTime<Utc>,
) -> Vec<FinalResultMissing> {
    let since = now - Duration::hours(FINAL_RESULT_WINDOW_HOURS);
    let mut tasks: Vec<&TaskView> = snapshot
        .tasks
        .iter()
        .filter(|task| {
            task.assignee == Assignee::Ai
                && task.draft.is_none()
                && task.archived_at.is_none()
                && !is_onboarding_sample(task.onboarding_sample.as_ref())
                && !task.acceptance_error
                && !task.acceptance.is_empty()
                && task.acceptance.iter().all(|item| item.done)
                && !task.results.iter().any(|r| r.kind == ResultKind::Final)
                && (task.task_status != Column::Done || task.task_status_changed_at >= since)
        })
        .collect();
    tasks.sort_by_key(|task| task.id);
    tasks
        .into_iter()
        .take(MAX_FINAL_RESULT_MISSING)
        .map(|task| FinalResultMissing {
            id: task.id,
            title: task.title.clone(),
            task_path: layout::task_md(&layout::task_dir(project_dir, task.id)),
        })
        .collect()
}
