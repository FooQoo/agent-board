use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{Column, RunState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Assignee {
    Ai,
    Human,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    Ai,
    Human,
}

/// Who is still writing a task or epic that is not yet put to work. `None` is a
/// normal task or epic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Draft {
    /// A person's work in progress in the browser.
    Human,
    /// A proposal an agent made; only a person can start it.
    Ai,
}

impl Draft {
    /// Read a stored `draft`. Files written before the owner was recorded hold
    /// `isDraft` as a boolean: `true` is a person's draft, `false` is none.
    pub fn deserialize_stored<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Draft>, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Stored {
            Flag(bool),
            Owner(Draft),
        }
        Ok(match Option::<Stored>::deserialize(deserializer)? {
            None | Some(Stored::Flag(false)) => None,
            Some(Stored::Flag(true)) => Some(Draft::Human),
            Some(Stored::Owner(owner)) => Some(owner),
        })
    }
}

pub type HistoryEvent = crate::file_store::model::HistoryRecord;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeContext {
    pub actor: Actor,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTask {
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub actor: Actor,
    /// The draft the task starts as. A task an agent creates is always an AI
    /// draft, whatever is given here.
    pub draft: Option<Draft>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changed<T> {
    pub value: T,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub task_status: Column,
    pub position: i64,
    pub agent_status: RunState,
    pub pending_reason: Option<String>,
    pub pending_request_id: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    /// A draft is not put to work yet. See [`Draft`].
    #[serde(
        default,
        alias = "isDraft",
        deserialize_with = "Draft::deserialize_stored"
    )]
    pub draft: Option<Draft>,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub history: Vec<HistoryEvent>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// Metadata for an image attached to a task. The image bytes are deliberately
/// excluded from snapshots and are returned only by an explicit read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size: i64,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentInput {
    pub id: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentData {
    pub metadata: Attachment,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkArchiveResult {
    pub tasks: Vec<Task>,
    pub archived_count: usize,
}

/// A backup that passed every check, ready to be restored. It carries only
/// what the backup file holds: no project ID, revision or cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedBoard {
    pub metadata: super::BoardMeta,
    pub tasks: Vec<Task>,
    pub attachments: Vec<ValidatedAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAttachment {
    pub task_id: i64,
    pub data: AttachmentData,
}
