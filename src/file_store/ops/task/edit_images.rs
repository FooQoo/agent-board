//! Saving a draft together with the images a person removed or added.

use chrono::{DateTime, Utc};

use crate::domain::{AttachmentInput, Changed, ProjectId, validate_title};
use crate::error::AgboardError;
use crate::file_store::model::TaskView;
use crate::file_store::reader;
use crate::file_store::{DraftSave, FileStore};

use super::super::attachment::staged::stage_images;
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
    /// refusal and every check on the image change set is decided before the
    /// first write. New image files are written first, the image list and the
    /// text are committed in one task save, and removed files are deleted only
    /// after that save succeeds, so a failed save leaves the prior state intact.
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
        let touched = !images.removed.is_empty() || !images.added.is_empty();
        let staged = stage_images(
            shared,
            &project_dir,
            &task,
            &images.removed,
            images.added,
            now,
        )?;
        let attachments = touched.then(|| staged.attachments.clone());
        // `Err` here means nothing was committed, so the new files are taken back.
        // After the commit they stay, because the saved task lists them.
        let saved = match self.save_draft_locked(
            &project_dir,
            project,
            id,
            (title, description),
            (finalize, attachments),
            now,
        ) {
            Ok(saved) => saved,
            Err(error) => {
                staged.discard();
                return Err(error);
            }
        };
        staged.finish();
        Ok(saved.into_changed(shared, &project_dir))
    }
}
