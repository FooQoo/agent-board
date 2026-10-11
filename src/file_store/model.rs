//! Persisted shapes of the shared files (MODEL.md, "共有領域の形式") and the
//! card view that the readers return.
//!
//! The file shapes are strict: unknown fields are rejected and every JSON file
//! carries `formatVersion`. The view is what callers receive for a card.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::frontmatter::AcceptanceItem;
use super::validate::EpicId;
use crate::domain::{Actor, Assignee, Attachment, Column, ProjectId, RunState};

/// `workspace.json`: the marker of the shared area.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub format: String,
    pub format_version: u32,
}

/// `project.json`: one project's identity and card counter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectFile {
    pub format_version: u32,
    pub id: ProjectId,
    pub name: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    pub next_card_id: i64,
}

/// One option of a decision request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// The kinds of history events. Epic events are written by the epic operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Created,
    Lane,
    Agent,
    Answer,
    Draft,
    Epic,
    Archive,
    Restore,
}

/// One history event of a card. Fields that only some kinds use are optional
/// and are left out of the JSON when they are empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub kind: HistoryKind,
    pub actor: Actor,
    pub reason: Option<String>,
    pub from_card_status: Option<Column>,
    pub to_card_status: Column,
    pub from_agent_status: Option<RunState>,
    pub to_agent_status: RunState,
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choices: Option<Vec<Choice>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choice_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_draft: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_epic_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_epic_id: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

/// Metadata of a file attached to a card as evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub id: String,
    pub name: String,
    pub size: i64,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

/// `task.json`: one card's operational state and history. Its text is in TASK.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskFile {
    pub format_version: u32,
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub epic_id: Option<String>,
    pub card_status: Column,
    pub agent_status: RunState,
    pub position: i64,
    pub is_draft: bool,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub pending_request_id: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    pub attachments: Vec<Attachment>,
    pub evidence: Vec<EvidenceRecord>,
    pub history: Vec<HistoryRecord>,
}

/// The decision request that a card is waiting on: the history event of the
/// pending request whose request ID the card names. The question and the
/// choices are kept only there.
pub fn current_request(task: &TaskFile) -> Option<&HistoryRecord> {
    let id = task.pending_request_id.as_deref()?;
    task.history.iter().rev().find(|event| {
        event.kind == HistoryKind::Agent
            && event.to_agent_status == RunState::Pending
            && event.request_id.as_deref() == Some(id)
    })
}

/// The epic a card belongs to, resolved from the epic's own file. Renaming or
/// recoloring the epic changes this; the card file keeps only the ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardEpic {
    pub id: EpicId,
    pub name: String,
    pub color: String,
}

/// A card as callers receive it: `task.json` plus `TASK.md`, with the pending
/// question and choices resolved from history, and the epic resolved from its file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub id: i64,
    pub title: String,
    pub description: String,
    /// TASK.md without its frontmatter. The whole file when the frontmatter has a defect.
    pub body: String,
    pub acceptance: Vec<AcceptanceItem>,
    pub acceptance_error: bool,
    pub assignee: Assignee,
    pub epic_id: Option<String>,
    pub epic: Option<CardEpic>,
    pub card_status: Column,
    pub position: i64,
    pub agent_status: RunState,
    pub is_draft: bool,
    pub pending_request_id: Option<String>,
    pub pending_reason: Option<String>,
    pub pending_choices: Vec<Choice>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub attachments: Vec<Attachment>,
    pub evidence: Vec<EvidenceRecord>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    pub history: Vec<HistoryRecord>,
}

/// `epic.json`: an epic's metadata. Its plan is in PLAN.md.
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

/// An epic as callers receive it: `epic.json` plus PLAN.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicView {
    pub id: EpicId,
    pub name: String,
    pub color: String,
    pub is_draft: bool,
    pub plan: String,
    /// PLAN.md without its frontmatter. The whole file when the frontmatter has a defect.
    pub body: String,
    pub acceptance: Vec<AcceptanceItem>,
    pub acceptance_error: bool,
    pub attachments: Vec<Attachment>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
}

/// The input of an epic creation. `id` is the ID as typed (folded to
/// uppercase when stored). A missing `color` gets a random one that no saved
/// epic uses. A missing or blank `plan` gets the PLAN.md template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEpic {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub is_draft: bool,
    pub plan: Option<String>,
}

/// The fields of an epic that an update may change. `None` keeps the value.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EpicUpdate {
    pub name: Option<String>,
    pub color: Option<String>,
    pub is_draft: Option<bool>,
    pub plan: Option<String>,
}

/// The owner of an image: a card (task) or an epic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentOwner {
    Card(i64),
    Epic(EpicId),
}

/// An image's metadata with the path of its file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAttachment {
    pub metadata: Attachment,
    pub path: PathBuf,
}

/// A text evidence record with its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceData {
    pub record: EvidenceRecord,
    pub bytes: Vec<u8>,
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
