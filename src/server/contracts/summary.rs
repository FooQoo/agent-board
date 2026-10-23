//! `GET .../projects/{projectId}/summary`: everything the board and the monitor list need, and
//! nothing that is read only when a card opens (no body, no acceptance text, no history, no epic
//! document, no image bytes).

use serde::{Deserialize, Serialize};

use super::{PendingChoice, Version};
use crate::domain::{Assignee, Column, RunState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Summary {
    pub project: SummaryProject,
    /// The version of the whole Summary; it changes when any item below changes.
    pub version: Version,
    pub tasks: Vec<SummaryTask>,
    pub epics: Vec<SummaryEpic>,
    pub problems: Vec<SummaryProblem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SummaryProject {
    pub id: String,
    pub name: String,
}

/// A task without `description`, `body`, `history` and the acceptance text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SummaryTask {
    pub id: i64,
    pub title: String,
    pub task_status: Column,
    pub agent_status: RunState,
    pub assignee: Assignee,
    pub is_draft: bool,
    pub position: i64,
    pub epic_id: Option<String>,
    pub acceptance: AcceptanceCount,
    /// The conditions cannot be read from the frontmatter; the full text is then the body.
    pub acceptance_error: bool,
    /// When the task was created.
    pub created_at: String,
    pub updated_at: String,
    pub pending_request_id: Option<String>,
    pub pending_reason: Option<String>,
    pub pending_choices: Vec<PendingChoice>,
    pub task_status_changed_at: String,
    pub agent_status_changed_at: String,
    /// The first-run guide's sample identity; absent for ordinary cards.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onboarding_sample: Option<OnboardingSampleRef>,
    pub detail_versions: DetailVersions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnboardingSampleRef {
    pub run_id: String,
    pub ordinal: u8,
}

/// Completed and total acceptance conditions, for the card's progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptanceCount {
    pub done: u32,
    pub total: u32,
}

/// The versions of a task's two Detail sections. A client compares them with its cache to tell
/// whether it must stream the section again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DetailVersions {
    pub document: Version,
    pub history: Version,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SummaryEpic {
    pub id: String,
    pub name: String,
    /// `#RRGGBB`.
    pub color: String,
    pub is_draft: bool,
    /// The IDs of the epic's tasks in the order the epic sets; empty when it sets none.
    pub priority: Vec<i64>,
    /// The stored order cannot be read, so it is ignored.
    pub priority_error: bool,
    pub progress: SummaryEpicProgress,
    pub detail_versions: EpicDetailVersions,
}

/// How many of an epic's tasks are in each group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryEpicProgress {
    pub todo: u32,
    pub doing: u32,
    pub done: u32,
    pub archived: u32,
    pub total: u32,
}

/// An epic has a document and no history of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EpicDetailVersions {
    pub document: Version,
}

/// A format defect in a shared file, as in the board.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryProblem {
    pub file: String,
    pub field: String,
    pub reason: String,
}
