//! Editing a task's title and body, and editing a draft.

use chrono::{DateTime, Utc};

use crate::domain::{Actor, Changed, ProjectId, validate_title};
use crate::error::AgboardError;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::model::TaskView;
use crate::file_store::reader;
use crate::file_store::{FileStore, TaskTextParts};

use super::super::{
    ensure_ai_task_not_done, lock_project, save_task_with_markdown, stamp, write_parts, write_text,
};
use super::draft::draft_event;
use super::{normalize_description, view};

impl FileStore {
    /// Change the title and/or the body of a task that is neither archived nor
    /// a draft. An unchanged value changes nothing and writes nothing.
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
        if task.is_draft {
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
        if task.is_draft {
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
        let title = title.map(validate_title).transpose()?;
        let description = description.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if !task.is_draft {
            return Err(AgboardError::TaskNotDraft { id });
        }
        let (text_changed, markdown) =
            write_text(shared, project, &project_dir, &mut task, title, description)?;
        if !text_changed && !finalize {
            return Ok(Changed {
                value: view(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        if text_changed {
            task.updated_at = at;
        }
        if finalize {
            task.is_draft = false;
            task.history.push(draft_event(
                &task,
                false,
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
        let title = title.map(validate_title).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if !task.is_draft {
            return Err(AgboardError::TaskNotDraft { id });
        }
        let title_changed = title.as_ref().is_some_and(|value| *value != task.title);
        let markdown = write_parts(
            shared,
            &project_dir,
            &mut task,
            parts.body,
            parts.acceptance,
        )?;
        let text_changed = title_changed || markdown.is_some();
        if !text_changed && !finalize {
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
        if finalize {
            task.is_draft = false;
            task.history.push(draft_event(
                &task,
                false,
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
