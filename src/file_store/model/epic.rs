//! Epic shapes: `epic.json`, the view callers receive and the create and update inputs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::Attachment;
use crate::file_store::validate::EpicId;

/// `epic.json`: an epic's metadata. Its document is in EPIC.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EpicFile {
    pub format_version: u32,
    pub id: EpicId,
    pub name: String,
    pub color: String,
    pub is_draft: bool,
    pub attachments: Vec<Attachment>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
}

/// An epic as callers receive it: `epic.json` plus EPIC.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicView {
    pub id: EpicId,
    pub name: String,
    pub color: String,
    pub is_draft: bool,
    pub document: String,
    /// EPIC.md without its frontmatter: the text after the closing line, or the whole file when there is no closing line.
    pub body: String,
    /// The task order of the epic (EPIC.md `priority`); empty when none is stored.
    pub priority: Vec<i64>,
    /// The stored `priority` cannot be read; the order is then ignored.
    pub priority_error: bool,
    pub attachments: Vec<Attachment>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
}

/// The input of an epic creation. `id` is the ID as typed (folded to
/// uppercase when stored). A missing `color` gets a random one that no saved
/// epic uses. A missing or blank `document` gets the EPIC.md template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEpic {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub is_draft: bool,
    pub document: Option<String>,
}

/// The fields of an epic that an update may change. `None` keeps the value.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EpicUpdate {
    pub name: Option<String>,
    pub color: Option<String>,
    pub is_draft: Option<bool>,
    pub document: Option<String>,
    /// Refuse the update with `epic_is_draft` while the epic is a draft. The
    /// check runs under the project lock, so a finalize cannot slip past it.
    pub refuse_if_draft: bool,
}
