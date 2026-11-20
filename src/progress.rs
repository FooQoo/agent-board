//! The progress table: the tasks an agent can pick up, grouped by epic in wave order.
//! `agboard progress` and the agent hook print this same table.
//!
//! A task is listed when it is in Todo or Doing and its agent status is not Pending. Done and
//! archived tasks are never listed; human-assigned tasks and drafts are, so the agent skips them.
//!
//! Open requests, unaccepted answers, and tasks lacking a final result are always listed. With
//! [`Include`] the caller also asks for tasks waiting for a decision and recently completed ones.

mod answers;
mod count;
mod epic_close;
mod final_result;
mod next;
mod requests;
mod text;
mod types;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::{Assignee, ChangeCursor, Column, ProjectMeta, ResultKind, RunState};
use crate::file_store::frontmatter;
use crate::file_store::layout;
use crate::file_store::model::{EpicView, TaskView};
use crate::file_store::onboarding_model::is_onboarding_sample;
use crate::file_store::reader::ProjectSnapshot;
use crate::nudge::Reminder;

/// The table as the CLI and the hook give it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub project: ProjectMeta,
    #[serde(with = "crate::clock::serde_utc")]
    pub fetched_at: DateTime<Utc>,
    pub version: String,
    pub cursor: ChangeCursor,
    /// The language saved in the board's settings, a hint for the language of
    /// replies (`ja`). Left out for English, the default, and when none is
    /// saved. The callers fill it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// Epics in ID order. An epic with no listed task is left out.
    pub epics: Vec<ProgressEpic>,
    pub unassigned: Vec<ProgressTask>,
    pub next_tasks: Vec<NextTask>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requests: Vec<ProgressRequest>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<ProgressAnswer>,
    /// AI tasks with all conditions met and no final result; left out when none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub final_result_missing: Vec<FinalResultMissing>,
    /// Epics whose tasks are all Done but whose `EPIC.md` still has an unchecked `- [ ]`; left
    /// out when none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub epics_to_close: Vec<EpicToClose>,
    /// What the nudge rules remind the agent of, from this table alone (see
    /// `crate::nudge`); left out when none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reminders: Vec<Reminder>,
    /// Tasks waiting for a decision, in ID order. Only when asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<Vec<ProgressTask>>,
    /// The most recently completed tasks of epics that still have Todo or
    /// Doing work, newest first. Only when asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<Vec<ProgressTask>>,
}

/// Extra sections of the table. The default adds nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Include {
    /// Add the tasks waiting for a decision, with their questions.
    pub pending: bool,
    /// Add this many of the most recently completed tasks of epics that still
    /// have Todo or Doing work; 0 adds none.
    pub done: usize,
}

pub use answers::{ProgressAnswer, unaccepted_answers};
pub use count::Count;
pub use final_result::{FinalResultMissing, final_result_missing};
pub use next::{MAX_NEXT_TASKS, NextReason, NextTask};
pub use requests::{ProgressRequest, open_requests};
pub use types::{EpicToClose, ProgressEpic, ProgressTask};

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
        let waves_error = frontmatter::waves_of(&epic.document).is_err();
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
            waves_error,
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

    let mut table = Progress {
        project: snapshot.project.clone(),
        fetched_at,
        version: snapshot.version.clone(),
        cursor: snapshot.cursor.clone(),
        locale: None,
        epics: groups,
        next_tasks: next::next_tasks(&listed, &project_dir),
        unassigned: unassigned
            .into_iter()
            .map(|task| task_of(task, &project_dir))
            .collect(),
        requests: open_requests(snapshot),
        answers: unaccepted_answers(snapshot),
        final_result_missing: final_result_missing(snapshot, &project_dir, fetched_at),
        epics_to_close: epic_close::epics_to_close(snapshot, &project_dir),
        reminders: Vec::new(),
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
    };
    table.reminders = crate::nudge::state_reminders(&table, fetched_at);
    table
}

/// Tasks in the same order shown by the progress table. Task selection uses
/// this list too, so epic ordering, EPIC.md waves and the unassigned tail stay
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
        let order = frontmatter::task_order(&epic.document);
        let mut tasks: Vec<&TaskView> = listed
            .iter()
            .copied()
            .filter(|task| task.epic_id.as_deref() == Some(epic.id.as_str()))
            .collect();
        tasks.sort_by_key(|task| (rank(&order, task.id), task.id));
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

/// Position in the flattened waves; a task that is not listed comes after all
/// listed tasks.
fn rank(order: &[i64], id: i64) -> usize {
    order
        .iter()
        .position(|listed| *listed == id)
        .unwrap_or(usize::MAX)
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
        acceptance: count::count(&task.acceptance),
        acceptance_error: task.acceptance_error,
        last_activity_at: (task.assignee == Assignee::Ai && task.agent_status == RunState::Running)
            .then(|| {
                task.history
                    .iter()
                    .map(|entry| entry.at)
                    .max()
                    .map_or(task.agent_status_changed_at, |at| {
                        at.max(task.agent_status_changed_at)
                    })
            }),
        has_final_result: task.assignee == Assignee::Ai
            && task.task_status == Column::Doing
            && task.results.iter().any(|r| r.kind == ResultKind::Final),
        question: if is_waiting(task) {
            task.pending_reason.as_deref().map(text::short_question)
        } else {
            None
        },
    }
}
