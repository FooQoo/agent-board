//! The response of a committed draft save, built from the values that were saved.

use std::path::Path;

use crate::domain::{Changed, ProjectId};
use crate::error::AgboardError;
use crate::file_store::model::{TaskFile, TaskView};
use crate::file_store::qa::{self, QaIndex};
use crate::file_store::reader;

/// What a committed draft save wrote: the task and the full TASK.md text.
pub(super) struct SavedDraft {
    pub task: TaskFile,
    pub description: String,
    pub changed: bool,
}

impl SavedDraft {
    /// The saved state: `markdown` is the text a save writes, or `None` when the
    /// stored TASK.md stays as it is, which is then read here, before any commit.
    pub fn capture(
        shared: &Path,
        project: &ProjectId,
        task: TaskFile,
        markdown: Option<String>,
        changed: bool,
    ) -> Result<Self, AgboardError> {
        let description = match markdown {
            Some(text) => text,
            None => reader::read_body(shared, project, task.id)?,
        };
        Ok(Self {
            task,
            description,
            changed,
        })
    }

    /// The view of the saved state, with no read that can fail the edit: the
    /// save is already committed, so epic and question details are added only
    /// when they can be read, and are left out otherwise.
    pub fn into_changed(self, shared: &Path, project_dir: &Path) -> Changed<TaskView> {
        let mut view = reader::task_view(self.task, self.description, None);
        reader::attach_epic(&mut view, &reader::read_epics(shared, project_dir).0);
        if let Ok(index) = QaIndex::load(shared, project_dir) {
            qa::apply(&mut view, &index);
        }
        Changed {
            value: view,
            changed: self.changed,
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::SavedDraft;
    use crate::domain::{Actor, Assignee, NewTask};
    use crate::file_store::{FileStore, reader};

    #[test]
    fn the_response_is_built_from_the_saved_state_even_when_nothing_can_be_read() {
        let now = Utc.with_ymd_and_hms(2026, 11, 21, 0, 0, 0).unwrap();
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join("shared");
        let store = FileStore::open(&shared);
        let project = store.create_project("Alpha", now).unwrap().id;
        let id = store
            .create_task(
                &project,
                NewTask {
                    title: "Card".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                now,
            )
            .unwrap()
            .id;
        let task = reader::read_task_strict(&shared, &project, id).unwrap();
        let saved =
            SavedDraft::capture(&shared, &project, task, Some("Saved text".into()), true).unwrap();
        // A folder that does not exist: every read after the commit would fail.
        let changed = saved.into_changed(&shared, &root.path().join("gone"));
        assert!(changed.changed);
        assert_eq!(changed.value.id, id);
        assert_eq!(changed.value.description, "Saved text");
    }
}
