//! The progress table: the tasks an agent can pick up, grouped by epic in
//! priority order. `agboard progress` and the agent hook print this same table.
//!
//! A task is listed when it is in Todo or Doing and its agent status is not
//! Pending. Done tasks and archived tasks are never listed. Human-assigned
//! tasks and drafts are listed, so the agent can see them and skip them.
//!
//! The caller can ask for two more sections with [`Include`]: the tasks waiting
//! for a decision (with the question) and the most recently completed tasks.
//! They are separate fields, so the default table is unchanged.
//!
//! Open requests are always listed, so an agent sees what a person asked it.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::{Assignee, ChangeCursor, Column, ProjectMeta, RunState};
use crate::file_store::frontmatter::{self, AcceptanceItem};
use crate::file_store::layout;
use crate::file_store::model::{EpicView, TaskView};
use crate::file_store::onboarding_model::is_onboarding_sample;
use crate::file_store::qa::RequestStatus;
use crate::file_store::reader::ProjectSnapshot;

/// The table as the CLI and the hook give it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub project: ProjectMeta,
    #[serde(with = "crate::clock::serde_utc")]
    pub fetched_at: DateTime<Utc>,
    pub version: String,
    pub cursor: ChangeCursor,
    /// Epics in ID order. An epic with no listed task is left out.
    pub epics: Vec<ProgressEpic>,
    /// Listed tasks that belong to no epic, in ID order.
    pub unassigned: Vec<ProgressTask>,
    /// Requests from a person that no agent has accepted or withdrawn, in ID order. Left out
    /// when there are none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requests: Vec<ProgressRequest>,
    /// Tasks waiting for a decision, in ID order. Only when asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<Vec<ProgressTask>>,
    /// The most recently completed tasks of epics that still have Todo or
    /// Doing work, newest first. Only when asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<Vec<ProgressTask>>,
}

/// An open request, shortened: the agent reads the whole text with `message show`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressRequest {
    pub id: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    /// The first line of the request, at most `TITLE_LIMIT` characters.
    pub title: String,
}

/// The open requests of a snapshot in ID order.
pub fn open_requests(snapshot: &ProjectSnapshot) -> Vec<ProgressRequest> {
    snapshot
        .requests
        .iter()
        .filter(|request| request.status == RequestStatus::Open)
        .map(|request| ProgressRequest {
            id: request.id.clone(),
            created_at: request.created_at,
            title: request_title(&request.body),
        })
        .collect()
}

/// Longest request title in the table, in characters.
const TITLE_LIMIT: usize = 80;

/// The first non-empty line without heading marks, cut to `TITLE_LIMIT` characters with an
/// ellipsis when it was longer.
fn request_title(body: &str) -> String {
    let line = body
        .lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.chars().count() <= TITLE_LIMIT {
        return line.to_string();
    }
    let cut: String = line.chars().take(TITLE_LIMIT).collect();
    format!("{cut}…")
}

/// Extra sections of the table. The default adds nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Include {
    /// Add the tasks waiting for a decision, each with its question.
    pub pending: bool,
    /// Add this many of the most recently completed tasks of epics that still
    /// have Todo or Doing work; 0 adds none.
    pub done: usize,
}

/// Longest question text in the table, in characters.
const QUESTION_LIMIT: usize = 200;

/// Conditions met out of conditions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Count {
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEpic {
    pub id: String,
    pub name: String,
    pub document_path: PathBuf,
    /// The `priority` list of EPIC.md cannot be read; the tasks keep ID order.
    pub priority_error: bool,
    pub tasks: Vec<ProgressTask>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressTask {
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub task_status: Column,
    pub agent_status: RunState,
    pub draft: Option<crate::domain::Draft>,
    pub task_path: PathBuf,
    pub acceptance: Count,
    pub acceptance_error: bool,
    /// The waiting question, shortened. Only on a task waiting for a decision.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}

/// Build the table from one project's unarchived snapshot. `shared` is the
/// shared folder the snapshot was read from; the paths point into it.
pub fn build(
    snapshot: &ProjectSnapshot,
    shared: &std::path::Path,
    fetched_at: DateTime<Utc>,
) -> Progress {
    build_with(snapshot, shared, fetched_at, Include::default())
}

/// [`build`] with the extra sections named by `include`.
pub fn build_with(
    snapshot: &ProjectSnapshot,
    shared: &std::path::Path,
    fetched_at: DateTime<Utc>,
    include: Include,
) -> Progress {
    let project_dir = layout::project_dir(shared, &snapshot.project.id);
    let listed = ordered_tasks(snapshot);

    let mut epics: Vec<&EpicView> = snapshot.epics.iter().collect();
    epics.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    let mut groups = Vec::new();
    for epic in epics {
        let priority_error = frontmatter::priority_of(&epic.document).is_err();
        let tasks: Vec<&TaskView> = listed
            .iter()
            .copied()
            .filter(|task| task.epic_id.as_deref() == Some(epic.id.as_str()))
            .collect();
        if tasks.is_empty() {
            continue;
        }
        let epic_dir = layout::epic_dir(&project_dir, &epic.id);
        groups.push(ProgressEpic {
            id: epic.id.as_str().to_string(),
            name: epic.name.clone(),
            document_path: layout::epic_document(&epic_dir),
            priority_error,
            tasks: tasks
                .into_iter()
                .map(|task| task_of(task, &project_dir))
                .collect(),
        });
    }

    let unassigned: Vec<&TaskView> = listed
        .iter()
        .copied()
        .filter(|task| {
            task.epic_id
                .as_deref()
                .is_none_or(|id| !snapshot.epics.iter().any(|epic| epic.id.as_str() == id))
        })
        .collect();

    // Done tasks are shown only for epics that still have Todo or Doing work
    // (a task waiting for a decision counts as open).
    let open_epics: std::collections::HashSet<&str> = snapshot
        .tasks
        .iter()
        .filter(|task| !is_sample(task) && matches!(task.task_status, Column::Todo | Column::Doing))
        .filter_map(|task| task.epic_id.as_deref())
        .collect();

    Progress {
        project: snapshot.project.clone(),
        fetched_at,
        version: snapshot.version.clone(),
        cursor: snapshot.cursor.clone(),
        epics: groups,
        unassigned: unassigned
            .into_iter()
            .map(|task| task_of(task, &project_dir))
            .collect(),
        requests: open_requests(snapshot),
        pending: include.pending.then(|| {
            let mut tasks: Vec<&TaskView> = snapshot
                .tasks
                .iter()
                .filter(|task| is_waiting(task))
                .collect();
            tasks.sort_by_key(|task| task.id);
            tasks
                .into_iter()
                .map(|task| task_of(task, &project_dir))
                .collect()
        }),
        done: (include.done > 0).then(|| {
            let mut tasks: Vec<&TaskView> = snapshot
                .tasks
                .iter()
                .filter(|task| task.task_status == Column::Done && !is_sample(task))
                .filter(|task| {
                    task.epic_id
                        .as_deref()
                        .is_some_and(|id| open_epics.contains(id))
                })
                .collect();
            tasks.sort_by_key(|task| (std::cmp::Reverse(task.task_status_changed_at), task.id));
            tasks
                .into_iter()
                .take(include.done)
                .map(|task| task_of(task, &project_dir))
                .collect()
        }),
    }
}

/// Tasks in the same order shown by the progress table. Task selection uses
/// this list too, so epic ordering, EPIC.md priority and the unassigned tail stay
/// one contract. This intentionally keeps progress' existing visibility
/// rules; callers apply any narrower selection predicate afterwards.
pub(crate) fn ordered_tasks(snapshot: &ProjectSnapshot) -> Vec<&TaskView> {
    let mut epics: Vec<&EpicView> = snapshot.epics.iter().collect();
    epics.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    let listed: Vec<&TaskView> = snapshot
        .tasks
        .iter()
        .filter(|task| is_listed(task))
        .collect();
    let mut ordered = Vec::new();
    for epic in epics {
        let priority = frontmatter::priority_of(&epic.document).unwrap_or_default();
        let mut tasks: Vec<&TaskView> = listed
            .iter()
            .copied()
            .filter(|task| task.epic_id.as_deref() == Some(epic.id.as_str()))
            .collect();
        tasks.sort_by_key(|task| (rank(&priority, task.id), task.id));
        ordered.extend(tasks);
    }
    let mut unassigned: Vec<&TaskView> = listed
        .iter()
        .copied()
        .filter(|task| {
            task.epic_id
                .as_deref()
                .is_none_or(|id| !snapshot.epics.iter().any(|epic| epic.id.as_str() == id))
        })
        .collect();
    unassigned.sort_by_key(|task| task.id);
    ordered.extend(unassigned);
    ordered
}

/// Guide sample cards are never work for agents, whatever their lane or run state.
fn is_sample(task: &TaskView) -> bool {
    is_onboarding_sample(task.onboarding_sample.as_ref())
}

fn is_listed(task: &TaskView) -> bool {
    matches!(task.task_status, Column::Todo | Column::Doing)
        && task.agent_status != RunState::Pending
        && !is_sample(task)
}

fn is_waiting(task: &TaskView) -> bool {
    matches!(task.task_status, Column::Todo | Column::Doing)
        && task.agent_status == RunState::Pending
        && !is_sample(task)
}

/// The question on one line, cut to `QUESTION_LIMIT` characters with an
/// ellipsis when it was longer.
fn short_question(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= QUESTION_LIMIT {
        return flat;
    }
    let cut: String = flat.chars().take(QUESTION_LIMIT).collect();
    format!("{cut}…")
}

/// Position in the priority list; a task that is not listed comes after all
/// listed tasks.
fn rank(priority: &[i64], id: i64) -> usize {
    priority
        .iter()
        .position(|listed| *listed == id)
        .unwrap_or(usize::MAX)
}

fn count(items: &[AcceptanceItem]) -> Count {
    Count {
        done: items.iter().filter(|item| item.done).count(),
        total: items.len(),
    }
}

fn task_of(task: &TaskView, project_dir: &std::path::Path) -> ProgressTask {
    ProgressTask {
        id: task.id,
        title: task.title.clone(),
        assignee: task.assignee,
        task_status: task.task_status,
        agent_status: task.agent_status,
        draft: task.draft,
        task_path: layout::task_md(&layout::task_dir(project_dir, task.id)),
        acceptance: count(&task.acceptance),
        acceptance_error: task.acceptance_error,
        question: if is_waiting(task) {
            task.pending_reason.as_deref().map(short_question)
        } else {
            None
        },
    }
}
