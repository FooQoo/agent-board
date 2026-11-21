//! Staging a task's whole image change set before it is committed.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::super::super::io;
use super::super::super::layout;
use super::super::super::model::{AttachmentOwner, TaskFile};
use super::{asset_file, stamp, write_image};
use crate::domain::{Attachment, AttachmentInput};
use crate::error::AgboardError;

/// An image change set that is checked and staged before anything is
/// committed: new files are written, the removed files stay where they are.
pub(in crate::file_store::ops) struct StagedImages {
    /// The task's images once the change set is committed.
    pub attachments: Vec<Attachment>,
    written: Vec<PathBuf>,
    removed: Vec<PathBuf>,
}

impl StagedImages {
    /// Take back the new files when the commit did not happen.
    pub fn discard(self) {
        for path in &self.written {
            let _ = fs::remove_file(path);
        }
    }

    /// Delete the removed files once the commit succeeded. The record no longer
    /// names them, so a file that stays behind is only unreferenced.
    pub fn finish(self) {
        for path in &self.removed {
            let _ = fs::remove_file(path);
        }
    }
}

/// Check every removal and addition against the task's images, write the new
/// files, and return the resulting list. A new ID may not reuse the ID of a
/// removed image, because both share one file path until the commit. On an
/// error the files written so far are removed again.
pub(in crate::file_store::ops) fn stage_images(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    removed: &[String],
    added: Vec<AttachmentInput>,
    now: DateTime<Utc>,
) -> Result<StagedImages, AgboardError> {
    let owner = AttachmentOwner::Task(task.id);
    let mut attachments = task.attachments.clone();
    let mut removed_paths = Vec::new();
    for attachment_id in removed {
        let index = attachments
            .iter()
            .position(|a| a.id == *attachment_id)
            .ok_or_else(|| AgboardError::AttachmentNotFound {
                id: attachment_id.clone(),
            })?;
        if let Some(version) = task
            .results
            .iter()
            .find(|r| r.image_ids().contains(&attachment_id.as_str()))
            .map(|r| r.version)
        {
            return Err(AgboardError::InvalidValue {
                field: "attachmentId".into(),
                reason: format!("Result version {version} uses this image."),
            });
        }
        let media_type = attachments[index].media_type.clone();
        let path = asset_file(project_dir, &owner, attachment_id, &media_type)?;
        let label = layout::shared_label(shared, &path);
        if layout::has_symlink_below(project_dir, &path).map_err(|e| io::write_error(&label, e))? {
            return Err(io::write_error(&label, "a symbolic link is in the way"));
        }
        attachments.remove(index);
        removed_paths.push(path);
    }
    let mut staged = StagedImages {
        attachments,
        written: Vec::new(),
        removed: removed_paths,
    };
    for input in added {
        let outcome = if task.attachments.iter().any(|a| a.id == input.id) {
            Err(AgboardError::InvalidValue {
                field: "attachmentId".into(),
                reason: "Attachment IDs must be unique.".into(),
            })
        } else {
            write_image(
                shared,
                project_dir,
                &owner,
                &staged.attachments,
                &input,
                stamp(now),
            )
        };
        match outcome {
            Ok((metadata, path)) => {
                staged.attachments.push(metadata);
                staged.written.push(path);
            }
            Err(error) => {
                staged.removed.clear();
                staged.discard();
                return Err(error);
            }
        }
    }
    Ok(staged)
}
