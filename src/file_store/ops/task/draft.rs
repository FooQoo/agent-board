//! The draft flag.

use chrono::{DateTime, Utc};

use crate::domain::{Changed, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::model::{HistoryRecord, TaskFile, TaskView};
use crate::file_store::reader;

use super::super::{HistoryKind, Transition, lock_project, save_task, stamp, transition_event};
use super::view;

impl FileStore {
    /// Turn the draft flag on or off. Only an idle or pending task can become a
    /// draft. The update time does not move; the history records the change.
    /// `discard` marks leaving the draft as a discard of its changes instead of
    /// a confirmation; it only applies when the flag is turned off.
    pub fn set_draft(
        &self,
        project: &ProjectId,
        id: i64,
        is_draft: bool,
        discard: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        if is_draft && discard {
            return Err(AgboardError::InvalidArgument {
                message: "discard cannot be combined with isDraft: true.".to_string(),
                command: None,
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.is_draft == is_draft {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        if is_draft && task.agent_status == RunState::Running {
            return Err(AgboardError::InvalidStateForDraft {
                id,
                state: task.agent_status,
            });
        }
        task.is_draft = is_draft;
        task.history.push(draft_event(
            &task,
            is_draft,
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
    is_draft: bool,
    discard: bool,
    at: DateTime<Utc>,
    language: HistoryLanguage,
) -> Result<HistoryRecord, AgboardError> {
    let event = transition_event(Transition {
        language,
        kind: HistoryKind::Draft,
        reason: Some(if is_draft {
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
