//! Editing a task's title and body, and editing a draft.

use chrono::{DateTime, Utc};

use crate::domain::{Actor, Changed, Column, Draft, ProjectId, validate_title};
use crate::error::AgboardError;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::model::{TaskFile, TaskView};
use crate::file_store::reader;
use crate::file_store::{DraftSave, FileStore, TaskTextParts};

use super::super::{
    ensure_ai_task_not_done, lock_project, save_task_with_markdown, stamp, write_parts, write_text,
};
use super::draft::draft_event;
use super::{normalize_description, view};

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

    /// Change the title and/or the body of a task that is neither archived nor
    /// a person's draft. An AI draft can be edited. An unchanged value changes nothing and writes nothing.
    pub fn edit_task(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let description = description.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.draft == Some(Draft::Human) {
            return Err(AgboardError::TaskIsDraft { id });
        }
        ensure_ai_task_not_done(&task, Actor::Ai)?;
        let (changed, markdown) =
            write_text(shared, project, &project_dir, &mut task, title, description)?;
        if !changed {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        task.updated_at = stamp(now);
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Edit body fields against the latest TASK.md read under the project lock.
    pub fn edit_task_parts(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        parts: TaskTextParts<'_>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.draft == Some(Draft::Human) {
            return Err(AgboardError::TaskIsDraft { id });
        }
        ensure_ai_task_not_done(&task, Actor::Ai)?;
        let title_changed = title.as_ref().is_some_and(|value| *value != task.title);
        let markdown = write_parts(
            shared,
            &project_dir,
            &mut task,
            parts.body,
            parts.acceptance,
        )?;
        if !title_changed && markdown.is_none() {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        if let Some(title) = title {
            task.title = title;
        }
        task.updated_at = stamp(now);
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Save the title and body of a draft. With `finalize`, the draft flag is
    /// cleared in the same operation. `updatedAt` moves only when a text changes.
    pub fn edit_draft_task(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        finalize: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.edit_draft_task_to(
            project,
            id,
            title,
            description,
            DraftSave::from_finalize(finalize),
            now,
        )
    }

    /// Like `edit_draft_task`, with the draft the task ends as: `None` saves and
    /// keeps the draft, `Some(None)` finalizes it.
    pub fn edit_draft_task_to(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        finalize: DraftSave,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let description = description.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        let Some(owner) = task.draft else {
            return Err(AgboardError::TaskNotDraft { id });
        };
        refuse_legacy_release_in_todo(&task, finalize.legacy_ai)?;
        let current = Some(owner);
        let target = resolve_finalize(finalize.target, owner);
        let (text_changed, markdown) =
            write_text(shared, project, &project_dir, &mut task, title, description)?;
        if !text_changed && target == current {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        if text_changed {
            task.updated_at = at;
        }
        if target != current {
            task.draft = target;
            task.history.push(draft_event(
                &task,
                target,
                false,
                at,
                match markdown.as_deref() {
                    Some(text) => self
                        .history_language
                        .unwrap_or_else(|| HistoryLanguage::infer(text, &task.title)),
                    None => self.history_language(project, &task)?,
                },
            )?);
        }
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
        Ok(Changed {
            value: view(shared, project, id)?,
            changed: true,
        })
    }

    /// Edit a draft against the latest TASK.md and finalize in one pair save.
    pub fn edit_draft_task_parts(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        parts: TaskTextParts<'_>,
        finalize: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.edit_draft_task_parts_to(
            project,
            id,
            title,
            parts,
            DraftSave::from_finalize(finalize),
            now,
        )
    }

    /// `edit_draft_task_to` for body and acceptance parts.
    pub fn edit_draft_task_parts_to(
        &self,
        project: &ProjectId,
        id: i64,
        title: Option<&str>,
        parts: TaskTextParts<'_>,
        finalize: DraftSave,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = title.map(validate_title).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        let Some(owner) = task.draft else {
            return Err(AgboardError::TaskNotDraft { id });
        };
        refuse_legacy_release_in_todo(&task, finalize.legacy_ai)?;
        let current = Some(owner);
        let target = resolve_finalize(finalize.target, owner);
        let title_changed = title.as_ref().is_some_and(|value| *value != task.title);
        let markdown = write_parts(
            shared,
            &project_dir,
            &mut task,
            parts.body,
            parts.acceptance,
        )?;
        let text_changed = title_changed || markdown.is_some();
        if !text_changed && target == current {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        if text_changed {
            task.updated_at = at;
        }
        if let Some(title) = title {
            task.title = title;
        }
        if target != current {
            task.draft = target;
            task.history.push(draft_event(
                &task,
                target,
                false,
                at,
                match markdown.as_deref() {
                    Some(text) => self
                        .history_language
                        .unwrap_or_else(|| HistoryLanguage::infer(text, &task.title)),
                    None => self.history_language(project, &task)?,
                },
            )?);
        }
        save_task_with_markdown(shared, &project_dir, &task, markdown.as_deref())?;
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

/// The draft a saved edit leaves: the current one when `finalize` is `None`.
fn resolve_finalize(finalize: Option<Option<Draft>>, current: Draft) -> Option<Draft> {
    finalize.unwrap_or(Some(current))
}
