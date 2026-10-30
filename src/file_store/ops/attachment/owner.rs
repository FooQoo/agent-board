//! The record that owns images, loaded and saved as one value.

use std::path::Path;

use crate::domain::{Attachment, ProjectId};
use crate::error::AgboardError;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{AttachmentOwner, EpicFile, TaskFile};
use crate::file_store::reader;

use super::super::epic::read_epic_file;
use super::super::{ensure_ai_task_not_done, save_task};
use chrono::{DateTime, Utc};

/// The record that owns the images, read strictly.
pub(super) enum Loaded {
    Task(Box<TaskFile>),
    Epic(EpicFile),
}

impl Loaded {
    pub(super) fn attachments(&self) -> &[Attachment] {
        match self {
            Loaded::Task(task) => &task.attachments,
            Loaded::Epic(epic) => &epic.attachments,
        }
    }

    pub(super) fn attachments_mut(&mut self) -> &mut Vec<Attachment> {
        match self {
            Loaded::Task(task) => &mut task.attachments,
            Loaded::Epic(epic) => &mut epic.attachments,
        }
    }

    pub(super) fn touch(&mut self, at: DateTime<Utc>) {
        match self {
            Loaded::Task(task) => task.updated_at = at,
            Loaded::Epic(epic) => epic.updated_at = at,
        }
    }

    /// A task that is archived takes no image changes for anyone. A draft
    /// takes none from the agent side (`block_drafts`); a person may change
    /// it. Epics have neither state.
    pub(super) fn ensure_writable(&self, block_drafts: bool) -> Result<(), AgboardError> {
        match self {
            Loaded::Task(task) if task.archived_at.is_some() => {
                Err(AgboardError::TaskArchived { id: task.id })
            }
            Loaded::Task(task) if block_drafts => {
                ensure_ai_task_not_done(task, crate::domain::Actor::Ai)?;
                if task.is_draft {
                    Err(AgboardError::TaskIsDraft { id: task.id })
                } else {
                    Ok(())
                }
            }
            Loaded::Task(task) if block_drafts && task.is_draft => {
                Err(AgboardError::TaskIsDraft { id: task.id })
            }
            _ => Ok(()),
        }
    }
}

pub(super) fn load(
    shared: &Path,
    project: &ProjectId,
    owner: &AttachmentOwner,
) -> Result<Loaded, AgboardError> {
    match owner {
        AttachmentOwner::Task(id) => Ok(Loaded::Task(Box::new(reader::read_task_strict(
            shared, project, *id,
        )?))),
        AttachmentOwner::Epic(id) => {
            read_epic_file(shared, project, id).map(|(_, file)| Loaded::Epic(file))
        }
    }
}

pub(super) fn save(shared: &Path, project_dir: &Path, loaded: &Loaded) -> Result<(), AgboardError> {
    match loaded {
        Loaded::Task(task) => save_task(shared, project_dir, task),
        Loaded::Epic(epic) => {
            let path = layout::epic_file(&layout::epic_dir(project_dir, &epic.id));
            io::write_json(&path, epic, &layout::shared_label(shared, &path))
        }
    }
}
