//! Image operations for a task or an epic: registration, deletion, and the
//! path of a stored image. An image belongs to one owner. An ID that belongs
//! to another owner, or to none, is `attachment_not_found`.
//!
//! The file is written under the owner's `assets/` folder and recorded in the
//! owner's JSON. The limits are per owner: 20 images, 50 MiB in total, and
//! 10 MiB per image (see `domain::validate_attachment`).

mod owner;

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::io;
use super::super::layout;
use super::super::model::{AttachmentOwner, StoredAttachment};
use super::super::reader;
use super::{lock_project, stamp};
use crate::domain::{
    Attachment, AttachmentInput, MAX_TASK_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS, ProjectId,
    validate_attachment,
};
use crate::error::AgboardError;

use self::owner::{load, save};

/// The file of an image: `assets/<id>.<ext>` below the owner's folder. The
/// ID is checked by the layout functions before a path exists.
fn asset_file(
    project_dir: &Path,
    owner: &AttachmentOwner,
    attachment_id: &str,
    media_type: &str,
) -> Result<PathBuf, AgboardError> {
    let ext = extension(media_type)?;
    match owner {
        AttachmentOwner::Task(id) => layout::task_asset_path(project_dir, *id, attachment_id, ext),
        AttachmentOwner::Epic(id) => layout::epic_asset_path(project_dir, id, attachment_id, ext),
    }
}

fn extension(media_type: &str) -> Result<&'static str, AgboardError> {
    layout::asset_extension(media_type).ok_or_else(|| AgboardError::InvalidValue {
        field: "attachment".into(),
        reason: "Only PNG, JPEG, WebP, and GIF images are accepted.".into(),
    })
}

fn check_limits(existing: &[Attachment], added_bytes: usize) -> Result<(), AgboardError> {
    let total: usize = existing
        .iter()
        .map(|a| usize::try_from(a.size).unwrap_or(0))
        .sum();
    if existing.len() + 1 > MAX_TASK_ATTACHMENTS
        || total.saturating_add(added_bytes) > MAX_TASK_ATTACHMENT_BYTES
    {
        return Err(AgboardError::AttachmentLimitExceeded);
    }
    Ok(())
}

/// The last part of a name sent by a client, so no folder part reaches the record.
pub(super) fn last_part(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_string()
}

impl FileStore {
    /// Register an image for a task or an epic, from the agent side (the CLI):
    /// a draft task refuses it with `task_is_draft`.
    pub fn add_attachment(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        input: AttachmentInput,
        now: DateTime<Utc>,
    ) -> Result<Attachment, AgboardError> {
        self.add_attachment_gated(project, owner, input, now, true)
    }

    /// Register an image from a person in the Web UI: a draft task accepts it.
    pub fn add_attachment_for_user(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        input: AttachmentInput,
        now: DateTime<Utc>,
    ) -> Result<Attachment, AgboardError> {
        self.add_attachment_gated(project, owner, input, now, false)
    }

    /// Register an image and write its file. The image is validated before
    /// anything is written; a failed save of the owner's JSON removes the new
    /// file again.
    fn add_attachment_gated(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        input: AttachmentInput,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<Attachment, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut loaded = load(shared, project, owner)?;
        loaded.ensure_writable(block_drafts)?;
        let media_type = validate_attachment(&input.id, &input.name, &input.bytes)?;
        if loaded.attachments().iter().any(|a| a.id == input.id) {
            return Err(AgboardError::InvalidValue {
                field: "attachmentId".into(),
                reason: "Attachment IDs must be unique.".into(),
            });
        }
        check_limits(loaded.attachments(), input.bytes.len())?;

        let path = asset_file(&project_dir, owner, &input.id, media_type)?;
        let label = layout::shared_label(shared, &path);
        if layout::has_symlink_below(&project_dir, &path).map_err(|e| io::write_error(&label, e))? {
            return Err(io::write_error(&label, "a symbolic link is in the way"));
        }
        let at = stamp(now);
        let metadata = Attachment {
            id: input.id.clone(),
            name: last_part(&input.name),
            media_type: media_type.to_string(),
            size: input.bytes.len() as i64,
            created_at: at,
        };
        // The file's parent is the owner's `assets/` folder.
        if let Some(assets) = path.parent() {
            fs::create_dir_all(assets).map_err(|e| io::write_error(&label, e))?;
        }
        io::write_atomic(&path, &input.bytes, &label)?;

        loaded.attachments_mut().push(metadata.clone());
        loaded.touch(at);
        if let Err(error) = save(shared, &project_dir, &loaded) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(metadata)
    }

    /// Remove an image from the agent side (the CLI). A draft task refuses it.
    pub fn delete_attachment(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        attachment_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        self.delete_attachment_gated(project, owner, attachment_id, now, true)
    }

    /// Remove an image from a person in the Web UI. A draft task accepts it.
    pub fn delete_attachment_for_user(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        attachment_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        self.delete_attachment_gated(project, owner, attachment_id, now, false)
    }

    /// Remove an image from its owner and delete its file. The owner's JSON is
    /// saved first, so a file left behind by a failed removal is not referenced.
    fn delete_attachment_gated(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        attachment_id: &str,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut loaded = load(shared, project, owner)?;
        loaded.ensure_writable(block_drafts)?;
        let index = loaded
            .attachments()
            .iter()
            .position(|a| a.id == attachment_id)
            .ok_or_else(|| AgboardError::AttachmentNotFound {
                id: attachment_id.to_string(),
            })?;
        let media_type = loaded.attachments()[index].media_type.clone();
        let path = asset_file(&project_dir, owner, attachment_id, &media_type)?;
        let label = layout::shared_label(shared, &path);
        if layout::has_symlink_below(&project_dir, &path).map_err(|e| io::write_error(&label, e))? {
            return Err(io::write_error(&label, "a symbolic link is in the way"));
        }

        loaded.attachments_mut().remove(index);
        loaded.touch(stamp(now));
        save(shared, &project_dir, &loaded)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io::write_error(&label, e)),
        }
    }

    /// The image's metadata and file path. An image that is not recorded for
    /// this owner, or whose path goes through a symbolic link, is
    /// `attachment_not_found`. Reads are allowed for archived tasks.
    pub fn attachment_path(
        &self,
        project: &ProjectId,
        owner: &AttachmentOwner,
        attachment_id: &str,
    ) -> Result<StoredAttachment, AgboardError> {
        let shared = self.shared_dir();
        let project_dir = reader::project_dir_checked(shared, project)?;
        let loaded = load(shared, project, owner)?;
        let metadata = loaded
            .attachments()
            .iter()
            .find(|a| a.id == attachment_id)
            .cloned()
            .ok_or_else(|| AgboardError::AttachmentNotFound {
                id: attachment_id.to_string(),
            })?;
        let path = asset_file(&project_dir, owner, &metadata.id, &metadata.media_type)?;
        let label = layout::shared_label(shared, &path);
        let linked = layout::has_symlink_below(&project_dir, &path)
            .map_err(|e| io::read_error(&label, e))?;
        if linked || !path.is_file() {
            return Err(AgboardError::AttachmentNotFound {
                id: attachment_id.to_string(),
            });
        }
        Ok(StoredAttachment { metadata, path })
    }
}
