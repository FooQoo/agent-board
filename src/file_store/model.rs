// file-size: allow (predates the 300-line limit; split it by responsibility rather than growing it)
//! Persisted shapes of the shared files (MODEL.md, "共有領域の形式") and the
//! task view that the readers return.
//!
//! The file shapes are strict: unknown fields are rejected and every JSON file
//! carries `formatVersion`. The view is what callers receive for a task.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::frontmatter::AcceptanceItem;
use super::validate::EpicId;
use crate::domain::{Actor, Assignee, Attachment, AttachmentInput, Column, ProjectId, RunState};

/// `workspace.json`: the marker of the shared area.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub format: String,
    pub format_version: u32,
}

/// `project.json`: one project's identity and task counter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectFile {
    pub format_version: u32,
    pub id: ProjectId,
    pub name: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    pub next_task_id: i64,
    /// The default epics were offered to this project. Set once, so a default
    /// epic that was deleted is not created again. Absent in older files.
    #[serde(default)]
    pub default_epics_seeded: bool,
}

/// One option of a decision request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// One human-readable history entry, stored only in TASK.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryRecord {
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
    pub reason: String,
}

/// The current decision request, independent of the history log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingRequest {
    pub question: String,
    pub choices: Vec<Choice>,
}

/// A workflow response retained for request-ID lookup after restart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RequestAnswer {
    pub request_id: String,
    pub actor: Actor,
    pub choice_id: Option<String>,
    pub choice_label: Option<String>,
    pub text: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

/// Metadata of a file attached to a task as evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub id: String,
    pub name: String,
    pub size: i64,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

/// In-memory task aggregate. Metadata is in `task.json`; text and history are in TASK.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskFile {
    pub format_version: u32,
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub epic_id: Option<String>,
    pub task_status: Column,
    pub agent_status: RunState,
    pub position: i64,
    pub is_draft: bool,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub pending_request_id: Option<String>,
    pub pending_request: Option<PendingRequest>,
    pub request_answers: Vec<RequestAnswer>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub task_status_changed_at: DateTime<Utc>,
    pub attachments: Vec<Attachment>,
    pub evidence: Vec<EvidenceRecord>,
    /// Legacy request metadata retained when reading existing task files.
    /// New simple requests do not write or use this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simple_request: Option<SimpleRequestMetadata>,
    pub history: Vec<HistoryRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SimpleRequestMetadata {
    pub request_id: String,
    pub payload_hash: String,
}

/// A submitted simple request for atomic FileStore creation.
#[derive(Debug, Clone)]
pub struct SimpleRequestInput {
    pub title: String,
    pub body: String,
    pub epic_id: Option<String>,
    pub images: Vec<AttachmentInput>,
}

/// `task.json`: operational metadata. History is stored only in TASK.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskMetadata {
    pub format_version: u32,
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub epic_id: Option<String>,
    pub task_status: Column,
    pub agent_status: RunState,
    pub position: i64,
    pub is_draft: bool,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub archived_at: Option<DateTime<Utc>>,
    pub pending_request_id: Option<String>,
    pub pending_request: Option<PendingRequest>,
    pub request_answers: Vec<RequestAnswer>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub task_status_changed_at: DateTime<Utc>,
    pub attachments: Vec<Attachment>,
    pub evidence: Vec<EvidenceRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simple_request: Option<SimpleRequestMetadata>,
}

impl From<&TaskFile> for TaskMetadata {
    fn from(task: &TaskFile) -> Self {
        Self {
            format_version: super::layout::FORMAT_VERSION,
            id: task.id,
            title: task.title.clone(),
            assignee: task.assignee,
            epic_id: task.epic_id.clone(),
            task_status: task.task_status,
            agent_status: task.agent_status,
            position: task.position,
            is_draft: task.is_draft,
            archived_at: task.archived_at,
            pending_request_id: task.pending_request_id.clone(),
            pending_request: task.pending_request.clone(),
            request_answers: task.request_answers.clone(),
            created_at: task.created_at,
            updated_at: task.updated_at,
            agent_status_changed_at: task.agent_status_changed_at,
            task_status_changed_at: task.task_status_changed_at,
            attachments: task.attachments.clone(),
            evidence: task.evidence.clone(),
            simple_request: task.simple_request.clone(),
        }
    }
}

impl TaskMetadata {
    /// Join persisted metadata with validated TASK.md events for operations.
    pub fn with_history(self, history: Vec<HistoryRecord>) -> TaskFile {
        TaskFile {
            format_version: self.format_version,
            id: self.id,
            title: self.title,
            assignee: self.assignee,
            epic_id: self.epic_id,
            task_status: self.task_status,
            agent_status: self.agent_status,
            position: self.position,
            is_draft: self.is_draft,
            archived_at: self.archived_at,
            pending_request_id: self.pending_request_id,
            pending_request: self.pending_request,
            request_answers: self.request_answers,
            created_at: self.created_at,
            updated_at: self.updated_at,
            agent_status_changed_at: self.agent_status_changed_at,
            task_status_changed_at: self.task_status_changed_at,
            attachments: self.attachments,
            evidence: self.evidence,
            simple_request: self.simple_request,
            history,
        }
    }
}

/// The request currently awaiting an answer.
pub fn current_request(task: &TaskFile) -> Option<&PendingRequest> {
    task.pending_request_id.as_ref()?;
    task.pending_request.as_ref()
}

/// The epic a task belongs to, resolved from the epic's own file. Renaming or
/// recoloring the epic changes this; the task file keeps only the ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEpic {
    pub id: EpicId,
    pub name: String,
    pub color: String,
}

/// A task as callers receive it: `task.json` plus `TASK.md`, with the pending
/// question and choices resolved from workflow metadata, and the epic resolved from its file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: i64,
    pub title: String,
    pub description: String,
    /// TASK.md without its frontmatter: the text after the closing line, or the whole file when there is no closing line.
    pub body: String,
    pub acceptance: Vec<AcceptanceItem>,
    pub acceptance_error: bool,
    pub assignee: Assignee,
    pub epic_id: Option<String>,
    pub epic: Option<TaskEpic>,
    pub task_status: Column,
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
    #[serde(with = "crate::clock::serde_utc")]
    pub task_status_changed_at: DateTime<Utc>,
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
    /// PLAN.md without its frontmatter: the text after the closing line, or the whole file when there is no closing line.
    pub body: String,
    /// The task order of the epic (PLAN.md `priority`); empty when none is stored.
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
