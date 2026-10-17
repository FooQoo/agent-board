//! The progress table: the tasks an agent can pick up, grouped by epic in
//! priority order. `agboard progress` and the agent hook print this same table.
//!
//! A task is listed when it is in Todo or Doing and its agent status is not
//! Pending. Done tasks and archived tasks are never listed. Human-assigned
//! tasks and drafts are listed, so the agent can see them and skip them.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::{Assignee, ChangeCursor, Column, ProjectMeta, RunState};
use crate::file_store::frontmatter::{self, AcceptanceItem};
use crate::file_store::layout;
use crate::file_store::model::{EpicView, TaskView};
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
}

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
    pub plan_path: PathBuf,
    /// The `priority` list of PLAN.md cannot be read; the tasks keep ID order.
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
    pub is_draft: bool,
    pub task_path: PathBuf,
    pub acceptance: Count,
    pub acceptance_error: bool,
}

/// Build the table from one project's unarchived snapshot. `shared` is the
/// shared folder the snapshot was read from; the paths point into it.
pub fn build(
    snapshot: &ProjectSnapshot,
    shared: &std::path::Path,
    fetched_at: DateTime<Utc>,
) -> Progress {
    let project_dir = layout::project_dir(shared, &snapshot.project.id);
    let listed: Vec<&TaskView> = snapshot
        .tasks
        .iter()
        .filter(|task| is_listed(task))
        .collect();

    let mut epics: Vec<&EpicView> = snapshot.epics.iter().collect();
    epics.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    let mut groups = Vec::new();
    for epic in epics {
        let (priority, priority_error) = match frontmatter::priority_of(&epic.plan) {
            Ok(order) => (order, false),
            Err(_) => (Vec::new(), true),
        };
        let mut tasks: Vec<&TaskView> = listed
            .iter()
            .copied()
            .filter(|task| task.epic_id.as_deref() == Some(epic.id.as_str()))
            .collect();
        if tasks.is_empty() {
            continue;
        }
        tasks.sort_by_key(|task| (rank(&priority, task.id), task.id));
        let epic_dir = layout::epic_dir(&project_dir, &epic.id);
        groups.push(ProgressEpic {
            id: epic.id.as_str().to_string(),
            name: epic.name.clone(),
            plan_path: layout::epic_plan(&epic_dir),
            priority_error,
            tasks: tasks
                .into_iter()
                .map(|task| task_of(task, &project_dir))
                .collect(),
        });
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
    }
}

fn is_listed(task: &TaskView) -> bool {
    matches!(task.task_status, Column::Todo | Column::Doing)
        && task.agent_status != RunState::Pending
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
        is_draft: task.is_draft,
        task_path: layout::task_md(&layout::task_dir(project_dir, task.id)),
        acceptance: count(&task.acceptance),
        acceptance_error: task.acceptance_error,
    }
}
