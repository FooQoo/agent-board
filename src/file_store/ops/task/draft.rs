//! The draft flag.

use chrono::{DateTime, Utc};

use crate::domain::{Changed, Column, Draft, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::model::{HistoryRecord, TaskFile, TaskView};
use crate::file_store::reader;

use super::super::{HistoryKind, Transition, lock_project, save_task, stamp, transition_event};
use super::view;

impl FileStore {
    /// Check, before anything else is changed, that a save an older client made with
    /// `draft: "ai"` is not refused by `refuse_legacy_release_in_todo`, so a rejected
    /// save has no side effect (such as removed attachments). The save checks again.
    pub fn ensure_legacy_release_allowed(
        &self,
        project: &ProjectId,
        id: i64,
        legacy_ai: bool,
    ) -> Result<(), AgboardError> {
        if !legacy_ai {
            return Ok(());
        }
        let shared = self.shared_dir();
        let (_project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        refuse_legacy_release_in_todo(&task, true)
    }

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
        self.set_draft_from(project, id, draft, discard, false, now)
    }

    /// Like `set_draft`. `legacy_ai` is set when an older client asked for `draft: null`
    /// with `"ai"`: a card in Todo or Doing is then refused (see
    /// `refuse_legacy_release_in_todo`) and a card in the Backlog only loses the edit lock.
    pub fn set_draft_from(
        &self,
        project: &ProjectId,
        id: i64,
        draft: Option<Draft>,
        discard: bool,
        legacy_ai: bool,
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
        refuse_legacy_release_in_todo(&task, legacy_ai)?;
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

/// An older client names `draft: "ai"` to hand a plan back to the AI. A plan is in the
/// Backlog now, where that only releases the edit lock. In Todo it would leave an
/// unsent card the agent can pick up, so the save is refused until a person takes the
/// card back to the Backlog. Checked under the project lock, with the lane just read.
pub(super) fn refuse_legacy_release_in_todo(
    task: &TaskFile,
    legacy_ai: bool,
) -> Result<(), AgboardError> {
    if legacy_ai && matches!(task.task_status, Column::Todo | Column::Doing) {
        return Err(AgboardError::InvalidValue {
            field: "draft".into(),
            reason: format!(
                "Task #{} is not in the Backlog, so handing it back to the AI would leave \
                 it ready to start. Take it back to the Backlog first, then save.",
                task.id
            ),
        });
    }
    Ok(())
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
