//! Deleting a task folder.

use std::fs;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::reader;

use super::super::lock_project;

impl FileStore {
    /// Delete an archived task's folder. Confirmation is the caller's job.
    pub fn delete_archived_task(&self, project: &ProjectId, id: i64) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_none() {
            return Err(AgboardError::TaskNotArchived { id });
        }
        let folder = layout::task_dir(&project_dir, id);
        fs::remove_dir_all(&folder)
            .map_err(|e| io::write_error(&layout::shared_label(shared, &folder), e))
    }

    /// its own confirmation; the Web API deletes only archived tasks.
    pub fn delete_task(&self, project: &ProjectId, id: i64) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let folder = layout::task_dir(&project_dir, id);
        if !folder.is_dir() {
            return Err(AgboardError::TaskNotFound { id });
        }
        let tasks = layout::tasks_dir(&project_dir);
        let label = layout::shared_label(shared, &folder);
        let trash = tasks.join(format!(
            ".deleting-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        fs::rename(&folder, &trash).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&tasks).map_err(|e| io::write_error(&label, e))?;
        fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))
    }
}
