//! The draft flag.

use chrono::{DateTime, Utc};

use crate::domain::{Changed, Draft, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::model::{HistoryRecord, TaskFile, TaskView};
use crate::file_store::reader;

use super::super::{HistoryKind, Transition, lock_project, save_task, stamp, transition_event};
use super::view;

impl FileStore {
    /// Take or release the edit lock: `Some(Draft::Human)` makes the task a
    /// person's draft (a Backlog card too, while a person edits the plan), and
    /// `None` finalizes it. Finalizing keeps the lane: a Backlog card stays in
    /// the Backlog, and only `send_task` hands it over. Only an idle or
    /// pending task can become a draft. The update time does not move; the history
    /// records the change. `discard` marks leaving the draft as a discard of its
    /// changes instead of a confirmation; it does not apply to turning it on.
    pub fn set_draft(
        &self,
        project: &ProjectId,
        id: i64,
        draft: Option<Draft>,
        discard: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        if draft == Some(Draft::Human) && discard {
            return Err(AgboardError::InvalidArgument {
                message: "discard cannot be combined with draft: \"human\".".to_string(),
                command: None,
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.draft == draft {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        if draft == Some(Draft::Human) && task.agent_status == RunState::Running {
            return Err(AgboardError::InvalidStateForDraft {
                id,
                state: task.agent_status,
            });
        }
        task.draft = draft;
        task.history.push(draft_event(
            &task,
            draft,
            discard,
            stamp(now),
            self.history_language(project, &task)?,
        )?);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }
}

/// A draft history event. The statuses are the task's current ones.
pub(super) fn draft_event(
    task: &TaskFile,
    draft: Option<Draft>,
    discard: bool,
    at: DateTime<Utc>,
    language: HistoryLanguage,
) -> Result<HistoryRecord, AgboardError> {
    let event = transition_event(Transition {
        language,
        kind: HistoryKind::Draft,
        reason: Some(if draft == Some(Draft::Human) {
            language.text("Marked task as draft.", "タスクを下書きにしました。")
        } else if discard {
            language.text("Discarded draft changes.", "下書きの変更を破棄しました。")
        } else {
            language.text("Finalized task draft.", "下書きを確定しました。")
        }),
        from_task: Some(task.task_status),
        to_task: task.task_status,
        from_agent: Some(task.agent_status),
        to_agent: task.agent_status,
        at,
    })?;
    Ok(event)
}
