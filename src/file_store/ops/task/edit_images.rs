//! Saving a draft together with the images a person removed or added.

use chrono::{DateTime, Utc};

use crate::domain::{AttachmentInput, Changed, ProjectId, validate_title};
use crate::error::AgboardError;
use crate::file_store::model::{AttachmentOwner, TaskView};
use crate::file_store::reader;
use crate::file_store::{DraftSave, FileStore};

use super::super::attachment::locked::{add_image_locked, delete_image_locked};
use super::super::lock_project;
use super::draft::refuse_legacy_release_in_todo;
use super::normalize_description;

/// The images a save removes and adds.
pub struct ImageChanges {
    pub removed: Vec<String>,
    pub added: Vec<AttachmentInput>,
}

impl FileStore {
    /// `edit_draft_task_to` plus image changes, all under one project lock. Every
    /// refusal (archived, not a draft, a legacy release in Todo) is decided before
    /// the first image changes, so a refused save leaves the images as they were.
    pub fn edit_draft_task_with_images(
        &self,
        project: &ProjectId,
        id: i64,
        text: (Option<&str>, Option<&str>),
        finalize: DraftSave,
        images: ImageChanges,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let title = text.0.map(validate_title).transpose()?;
        let description = text.1.map(normalize_description).transpose()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.draft.is_none() {
            return Err(AgboardError::TaskNotDraft { id });
        }
        refuse_legacy_release_in_todo(&task, finalize.legacy_ai)?;
        let owner = AttachmentOwner::Task(id);
        let touched = !images.removed.is_empty() || !images.added.is_empty();
        for attachment_id in &images.removed {
            delete_image_locked(
                shared,
                &project_dir,
                project,
                &owner,
                attachment_id,
                now,
                false,
            )?;
        }
        for input in images.added {
            add_image_locked(shared, &project_dir, project, &owner, input, now, false)?;
        }
        let mut saved = self.edit_draft_locked(
            &project_dir,
            project,
            id,
            (title, description),
            finalize,
            now,
        )?;
        saved.changed |= touched;
        Ok(saved)
    }
}
