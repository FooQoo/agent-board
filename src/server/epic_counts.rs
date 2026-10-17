//! The per-epic task counts that the epic list shows. Each task of an epic is
//! counted once: an archived task counts as archived whatever lane it was in,
//! and every other task counts in its lane. The four counts add up to `total`.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::domain::Column;
use crate::file_store::model::{EpicView, TaskView};

/// The number of an epic's tasks in each of the four groups.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicTaskCounts {
    pub todo: usize,
    pub doing: usize,
    pub done: usize,
    pub archived: usize,
    pub total: usize,
}

/// The counts of every epic in `epics`, keyed by epic ID. An epic with no tasks
/// gets zeros. A task whose epic is not in `epics` is counted for no epic.
pub fn task_counts_by_epic(
    epics: &[EpicView],
    tasks: &[TaskView],
) -> BTreeMap<String, EpicTaskCounts> {
    let mut counts: BTreeMap<String, EpicTaskCounts> = epics
        .iter()
        .map(|epic| (epic.id.as_str().to_string(), EpicTaskCounts::default()))
        .collect();
    for task in tasks {
        let Some(entry) = task.epic_id.as_deref().and_then(|id| counts.get_mut(id)) else {
            continue;
        };
        if task.archived_at.is_some() {
            entry.archived += 1;
        } else {
            match task.task_status {
                Column::Todo => entry.todo += 1,
                Column::Doing => entry.doing += 1,
                Column::Done => entry.done += 1,
            }
        }
        entry.total += 1;
    }
    counts
}
