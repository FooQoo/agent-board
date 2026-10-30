//! Attachment ownership, stored image paths and read-time problems.

use std::path::PathBuf;

use serde::Serialize;

use crate::domain::Attachment;
use crate::file_store::validate::EpicId;

/// The owner of an image: a task (task) or an epic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentOwner {
    Task(i64),
    Epic(EpicId),
}

/// An image's metadata with the path of its file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAttachment {
    pub metadata: Attachment,
    pub path: PathBuf,
}

/// A format defect in a file that was read anyway. `file` is relative to the
/// project folder, `field` names the item, and `reason` is in English.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub file: String,
    pub field: String,
    pub reason: String,
}
