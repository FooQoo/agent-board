//! The Summary projection of one project and the change sets between two projections.
//!
//! A projection is built from a project snapshot that is already parsed, so it never reads the
//! Markdown again. Every task has a hash of its summary fields and a version for each of its
//! two Detail sections (document and history); every epic has the same for its summary and its
//! document. The versions are SHA-256 hashes (first 16 bytes, hexadecimal) of the parsed data,
//! so they are the same after a restart when the content is the same.

mod build;
mod changes;
mod diff;

use std::collections::BTreeMap;

use serde::Serialize;

use super::model::{Choice, Problem};
use crate::domain::{Assignee, Column, RunState};

pub use build::project;
pub use changes::{ChangeSet, ChangeSink, Facet, Resource, ResourceChange, ResourceId};
pub(crate) use changes::{invalid_changes, project_change, ready_changes};
pub use diff::{diff, invalidate_all};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaskSummaryFields {
    pub id: i64,
    pub title: String,
    pub task_status: Column,
    pub agent_status: RunState,
    pub assignee: Assignee,
    pub is_draft: bool,
    pub position: i64,
    pub epic_id: Option<String>,
    pub acceptance_done: u32,
    pub acceptance_total: u32,
    pub updated_at: String,
    pub pending_request_id: Option<String>,
    pub pending_reason: Option<String>,
    pub pending_choices: Vec<Choice>,
    pub task_status_changed_at: String,
    pub agent_status_changed_at: String,
    /// The first-run guide's sample identity: `(runId, ordinal)`.
    pub onboarding_sample: Option<(String, u8)>,
}

/// One task of a projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskProjection {
    pub fields: TaskSummaryFields,
    /// An archived task is in the projection (so a move to the archive is a `summary` change)
    /// but not in the Summary.
    pub archived: bool,
    /// A file of the task has a defect: the change of any facet changes all of them.
    pub damaged: bool,
    pub summary_hash: String,
    pub document_version: String,
    pub history_version: String,
}

/// The Summary fields of an epic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EpicSummaryFields {
    pub id: String,
    pub name: String,
    pub color: String,
    pub is_draft: bool,
}

/// How many of an epic's tasks are in each group.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct EpicProgress {
    pub todo: u32,
    pub doing: u32,
    pub done: u32,
    pub archived: u32,
    pub total: u32,
}

/// One epic of a projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicProjection {
    pub fields: EpicSummaryFields,
    pub progress: EpicProgress,
    pub damaged: bool,
    pub summary_hash: String,
    pub document_version: String,
}

/// What the index keeps of one project's Summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    pub project_id: String,
    pub project_name: String,
    /// The version of the whole Summary (the archived tasks are not part of it).
    pub version: String,
    pub tasks: Vec<TaskProjection>,
    pub epics: Vec<EpicProjection>,
    pub problems: Vec<Problem>,
    /// Tasks and epics that could not be read at all, with a digest of their raw files.
    broken_tasks: BTreeMap<i64, String>,
    broken_epics: BTreeMap<String, String>,
}
