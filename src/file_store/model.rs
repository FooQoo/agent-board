//! Persisted shapes of the shared files (MODEL.md, "共有領域の形式") and the
//! task view that the readers return.
//!
//! The file shapes are strict: unknown fields are rejected and every JSON file
//! carries `formatVersion`. The view is what callers receive for a task.

mod attachment;
mod epic;
mod task;

pub use self::attachment::*;
pub use self::epic::*;
pub use self::task::*;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::{Actor, ProjectId};

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
