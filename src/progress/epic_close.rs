//! `epicsToClose`: epics whose tasks are all Done while `EPIC.md` still has an unchecked
//! reference condition. The text comes from the snapshot; a missing file reads as empty.

use crate::domain::Column;
use crate::file_store::layout;
use crate::file_store::onboarding_model::is_onboarding_sample;
use crate::file_store::reader::ProjectSnapshot;

use super::EpicToClose;

/// The epics that serve as buckets for stray work; they are never closed.
const OPEN_ENDED: [&str; 2] = ["BUG", "ENHANCEMENT"];

/// Epics other than the open-ended ones with at least one unarchived task, every one Done, and
/// an unchecked `- [ ]` in the body of `EPIC.md`. In ID order.
pub(super) fn epics_to_close(
    snapshot: &ProjectSnapshot,
    project_dir: &std::path::Path,
) -> Vec<EpicToClose> {
    let mut epics: Vec<_> = snapshot
        .epics
        .iter()
        .filter(|epic| !OPEN_ENDED.contains(&epic.id.as_str()) && epic.draft.is_none())
        .filter(|epic| has_unchecked_condition(&epic.body))
        .filter(|epic| {
            let mut tasks = snapshot
                .tasks
                .iter()
                .filter(|task| {
                    task.epic_id.as_deref() == Some(epic.id.as_str())
                        && task.archived_at.is_none()
                        && !is_onboarding_sample(task.onboarding_sample.as_ref())
                })
                .peekable();
            tasks.peek().is_some() && tasks.all(|task| task.task_status == Column::Done)
        })
        .collect();
    epics.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    epics
        .into_iter()
        .map(|epic| EpicToClose {
            id: epic.id.as_str().to_string(),
            name: epic.name.clone(),
            document_path: layout::epic_document(&layout::epic_dir(project_dir, &epic.id)),
        })
        .collect()
}

fn has_unchecked_condition(body: &str) -> bool {
    body.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with("- [ ]") || line.starts_with("* [ ]")
    })
}
