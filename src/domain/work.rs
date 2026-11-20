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

/// Whether a recorded result is an intermediate one or the final one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultKind {
    /// A first or intermediate result delivered while the work goes on.
    Progress,
    /// The result of the finished work.
    Final,
}

impl ResultKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Progress => "progress",
            Self::Final => "final",
        }
    }
}

/// A result delivered to the requester: a short summary, optionally with an
/// image (an attachment of the same task) and a link to the main artifact.
/// `version` counts up from 1 within the task and never changes or repeats;
/// `key` identifies the delivery, so a retry finds the entry it already made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "StoredTaskResult", rename_all = "camelCase")]
pub struct TaskResult {
    pub version: u32,
    pub key: String,
    pub kind: ResultKind,
    /// The heading of the result, at most `MAX_RESULT_TITLE_CHARS` characters.
    /// It is the title the agent gave or, for a result recorded without one,
    /// the first sentence of the summary (see `derive_result_title`), so it is
    /// always present.
    pub title: String,
    pub summary: String,
    /// The image of a result that has exactly one. Written for one image so
    /// that the file stays readable by older versions; see `image_ids`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_id: Option<String>,
    /// The images of a result that has several, in the order they were given.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachment_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

/// The longest result title, in characters.
pub const MAX_RESULT_TITLE_CHARS: usize = 80;

/// The title of a result that was recorded without one: the first sentence of
/// the summary, cut to `MAX_RESULT_TITLE_CHARS` characters (the last one is
/// `…` when it was cut). A sentence ends at the first line break, at `。`, `！`
/// or `？`, or at `.`, `!` or `?` followed by white space or the end.
pub fn derive_result_title(summary: &str) -> String {
    let line = crate::domain::first_line_plain(summary);
    let chars: Vec<char> = line.chars().collect();
    let mut end = chars.len();
    for (i, c) in chars.iter().enumerate() {
        let ideographic = matches!(c, '。' | '！' | '？');
        let latin =
            matches!(c, '.' | '!' | '?') && chars.get(i + 1).is_none_or(|n| n.is_whitespace());
        if ideographic || latin {
            end = i + 1;
            break;
        }
    }
    let sentence: Vec<char> = chars[..end].to_vec();
    if sentence.len() > MAX_RESULT_TITLE_CHARS {
        let mut cut: String = sentence[..MAX_RESULT_TITLE_CHARS - 1].iter().collect();
        cut.push('…');
        cut
    } else {
        sentence.into_iter().collect()
    }
}

/// `task.json` entry of a result as stored: `title` is absent from results
/// recorded before titles existed, and is derived when the entry is read.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredTaskResult {
    version: u32,
    key: String,
    kind: ResultKind,
    #[serde(default)]
    title: Option<String>,
    summary: String,
    #[serde(default)]
    attachment_id: Option<String>,
    #[serde(default)]
    attachment_ids: Vec<String>,
    #[serde(default)]
    link: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    at: DateTime<Utc>,
}

impl From<StoredTaskResult> for TaskResult {
    fn from(s: StoredTaskResult) -> Self {
        let title = s
            .title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| derive_result_title(&s.summary));
        Self {
            version: s.version,
            key: s.key,
            kind: s.kind,
            title,
            summary: s.summary,
            attachment_id: s.attachment_id,
            attachment_ids: s.attachment_ids,
            link: s.link,
            at: s.at,
        }
    }
}

impl TaskResult {
    /// Every image of the result in order, whichever field holds them.
    pub fn image_ids(&self) -> Vec<&str> {
        if self.attachment_ids.is_empty() {
            self.attachment_id.iter().map(String::as_str).collect()
        } else {
            self.attachment_ids.iter().map(String::as_str).collect()
        }
    }

    /// The images as the fields store them: one image in `attachmentId`, two
    /// or more in `attachmentIds`.
    pub fn with_images(mut self, ids: Vec<String>) -> Self {
        if ids.len() == 1 {
            self.attachment_id = ids.into_iter().next();
            self.attachment_ids = Vec::new();
        } else {
            self.attachment_id = None;
            self.attachment_ids = ids;
        }
        self
    }
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
