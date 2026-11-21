//! The image operations for a caller that already holds the project lock, so an
//! edit can change a task's images and its text in one locked step.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};

use super::super::super::io;
use super::super::super::layout;
use super::super::super::model::AttachmentOwner;
use super::owner::{load, save};
use super::{asset_file, stamp, write_image};
use crate::domain::{Attachment, AttachmentInput, ProjectId};
use crate::error::AgboardError;

/// `add_attachment_gated` for a caller that already holds the project lock.
pub(in crate::file_store::ops) fn add_image_locked(
    shared: &Path,
    project_dir: &Path,
    project: &ProjectId,
    owner: &AttachmentOwner,
    input: AttachmentInput,
    now: DateTime<Utc>,
    block_drafts: bool,
) -> Result<Attachment, AgboardError> {
    {
        let mut loaded = load(shared, project, owner)?;
        loaded.ensure_writable(block_drafts)?;
        let (metadata, path) = write_image(
            shared,
            project_dir,
            owner,
            loaded.attachments(),
            &input,
            stamp(now),
        )?;
        loaded.attachments_mut().push(metadata.clone());
        loaded.touch(metadata.created_at);
        if let Err(error) = save(shared, project_dir, &loaded) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(metadata)
    }
}

/// `delete_attachment_gated` for a caller that already holds the project lock.
pub(in crate::file_store::ops) fn delete_image_locked(
    shared: &Path,
    project_dir: &Path,
    project: &ProjectId,
    owner: &AttachmentOwner,
    attachment_id: &str,
    now: DateTime<Utc>,
    block_drafts: bool,
) -> Result<(), AgboardError> {
    let mut loaded = load(shared, project, owner)?;
    loaded.ensure_writable(block_drafts)?;
    let index = loaded
        .attachments()
        .iter()
        .position(|a| a.id == attachment_id)
        .ok_or_else(|| AgboardError::AttachmentNotFound {
            id: attachment_id.to_string(),
        })?;
    if let Some(version) = loaded.result_using(attachment_id) {
        return Err(AgboardError::InvalidValue {
            field: "attachmentId".into(),
            reason: format!("Result version {version} uses this image."),
        });
    }
    let media_type = loaded.attachments()[index].media_type.clone();
    let path = asset_file(project_dir, owner, attachment_id, &media_type)?;
    let label = layout::shared_label(shared, &path);
    if layout::has_symlink_below(project_dir, &path).map_err(|e| io::write_error(&label, e))? {
        return Err(io::write_error(&label, "a symbolic link is in the way"));
    }
    loaded.attachments_mut().remove(index);
    loaded.touch(stamp(now));
    save(shared, project_dir, &loaded)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io::write_error(&label, e)),
    }
}
