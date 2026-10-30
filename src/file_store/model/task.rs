//! Task shapes: the in-memory aggregate, the `task.json` metadata and the
//! view that the readers return.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{Choice, HistoryRecord, PendingRequest, RequestAnswer};
use crate::domain::{Assignee, Attachment, AttachmentInput, Column, RunState};
use crate::file_store::frontmatter::AcceptanceItem;
use crate::file_store::onboarding_model::OnboardingSample;
use crate::file_store::validate::EpicId;

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
    /// Legacy request metadata retained when reading existing task files.
    /// New simple requests do not write or use this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simple_request: Option<SimpleRequestMetadata>,
    /// The guide's sample identity; absent for every ordinary card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onboarding_sample: Option<OnboardingSample>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simple_request: Option<SimpleRequestMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onboarding_sample: Option<OnboardingSample>,
}

impl From<&TaskFile> for TaskMetadata {
    fn from(task: &TaskFile) -> Self {
        Self {
            format_version: crate::file_store::layout::FORMAT_VERSION,
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
            simple_request: task.simple_request.clone(),
            onboarding_sample: task.onboarding_sample.clone(),
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
            simple_request: self.simple_request,
            onboarding_sample: self.onboarding_sample,
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
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub agent_status_changed_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub task_status_changed_at: DateTime<Utc>,
    /// The guide's sample identity; absent for every ordinary card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onboarding_sample: Option<OnboardingSample>,
    pub history: Vec<HistoryRecord>,
}
