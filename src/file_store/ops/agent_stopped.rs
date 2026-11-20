//! The note the board leaves when the resident agent stops on an error while it holds a task.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::model::HistoryRecord;
use super::super::reader;
use super::{lock_project, save_task, stamp};
use crate::domain::{Assignee, Column, ProjectId, RunState};
use crate::error::AgboardError;

/// The longest error text kept in the note, in characters.
const DETAIL_MAX: usize = 200;

/// The error as one short line.
fn short(detail: &str) -> String {
    let line = detail.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(DETAIL_MAX) {
        Some((end, _)) => format!("{}...", &line[..end]),
        None => line,
    }
}

impl FileStore {
    /// Record that the resident agent stopped on an error while it was working on task `id`.
    /// Only a task that is still Running in Doing and is the agent's own is touched: it gets one
    /// history entry (in the language of the task body) and goes back to idle in the same save,
    /// so another agent can take it. Returns whether the task was changed. A task in any other
    /// state has nobody left hanging, so it is left alone.
    pub fn record_agent_stopped(
        &self,
        project: &ProjectId,
        id: i64,
        detail: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some()
            || task.draft.is_some()
            || task.assignee != Assignee::Ai
            || task.task_status != Column::Doing
            || task.agent_status != RunState::Running
        {
            return Ok(false);
        }
        let detail = short(detail);
        let language = self.history_language(project, &task)?;
        let english = format!(
            "The resident agent stopped on an error ({detail}). Another agent needs to take over \
             this task; the agent is idle again."
        );
        let japanese = format!(
            "常駐エージェントがエラーで止まりました（{detail}）。別のエージェントがこのタスクを\
             引き継ぐ必要があります。エージェントはidleに戻しました。"
        );
        let at = stamp(now);
        let reason = super::reason_or_default(None, language.text(&english, &japanese).to_owned())?;
        task.history.push(HistoryRecord { at, reason });
        task.agent_status = RunState::Idle;
        task.agent_status_changed_at = at;
        task.updated_at = at;
        save_task(shared, &project_dir, &task)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::domain::{Actor, ChangeContext, NewTask};

    fn setup(title: &str, description: &str) -> (tempfile::TempDir, FileStore, ProjectId, i64) {
        let root = tempfile::tempdir().unwrap();
        let store = FileStore::open(&root.path().join("shared"));
        let project = store.create_project("Demo", Utc::now()).unwrap().id;
        let task = store
            .create_task(
                &project,
                NewTask {
                    title: title.into(),
                    description: description.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    draft: None,
                },
                Utc::now(),
            )
            .unwrap()
            .id;
        (root, store, project, task)
    }

    fn run(store: &FileStore, project: &ProjectId, id: i64) {
        let ctx = || ChangeContext {
            actor: Actor::Ai,
            reason: "Start".into(),
        };
        store
            .move_work_task(project, id, Column::Doing, ctx(), Utc::now())
            .unwrap();
        store
            .set_agent_status(project, id, RunState::Running, ctx(), Utc::now())
            .unwrap();
    }

    #[test]
    fn a_running_task_gets_one_note_in_its_language_and_goes_idle() {
        let (_root, store, project, id) = setup("日本語のタスク", "");
        run(&store, &project, id);
        let before = store.task(&project, id).unwrap().history.len();
        assert!(
            store
                .record_agent_stopped(&project, id, "boom\nline", Utc::now())
                .unwrap()
        );
        let task = store.task(&project, id).unwrap();
        assert_eq!(task.history.len(), before + 1);
        let note = &task.history.last().unwrap().reason;
        assert!(note.contains("常駐エージェントがエラーで止まりました（boom line）"));
        assert_eq!(task.agent_status, RunState::Idle);
        assert_eq!(task.task_status, Column::Doing);
        // Idle now, so a second report changes nothing.
        assert!(
            !store
                .record_agent_stopped(&project, id, "boom", Utc::now())
                .unwrap()
        );
    }

    #[test]
    fn english_tasks_get_english_notes_and_long_errors_are_cut() {
        let (_root, store, project, id) = setup("English task", "");
        run(&store, &project, id);
        let long = "x".repeat(500);
        store
            .record_agent_stopped(&project, id, &long, Utc::now())
            .unwrap();
        let task = store.task(&project, id).unwrap();
        let note = &task.history.last().unwrap().reason;
        assert!(note.starts_with("The resident agent stopped on an error"));
        assert!(note.contains(&format!("{}...", "x".repeat(DETAIL_MAX))));
    }

    #[test]
    fn a_task_that_is_not_running_is_left_alone() {
        let (_root, store, project, id) = setup("Idle task", "");
        assert!(
            !store
                .record_agent_stopped(&project, id, "boom", Utc::now())
                .unwrap()
        );
        assert_eq!(store.task(&project, id).unwrap().history.len(), 1);
    }
}
