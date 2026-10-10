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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Created,
    Lane,
    Agent,
    Archive,
    Restore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: i64,
    pub kind: HistoryKind,
    pub actor: Actor,
    pub reason: Option<String>,
    pub from_card_status: Option<Column>,
    pub to_card_status: Column,
    pub from_agent_status: Option<RunState>,
    pub to_agent_status: RunState,
    pub request_id: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeContext {
    pub actor: Actor,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCard {
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub actor: Actor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changed<T> {
    pub value: T,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub card_status: Column,
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
    /// A draft is read-only for agents until the user finalizes it.
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub history: Vec<HistoryEvent>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// Metadata for an image attached to a card. The image bytes are deliberately
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
    pub cards: Vec<Card>,
    pub archived_count: usize,
}

/// A backup that passed every check, ready to be restored. It carries only
/// what the backup file holds: no project ID, revision or cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedBoard {
    pub metadata: super::BoardMeta,
    pub cards: Vec<Card>,
    pub attachments: Vec<ValidatedAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedAttachment {
    pub card_id: i64,
    pub data: AttachmentData,
}
