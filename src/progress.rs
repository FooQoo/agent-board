//! The progress table: the cards an agent can pick up, grouped by epic in
//! priority order. `agboard progress` and the agent hook print this same table.
//!
//! A card is listed when it is in Todo or Doing and its agent status is not
//! Pending. Done cards and archived cards are never listed. Human-assigned
//! cards and drafts are listed, so the agent can see them and skip them.

use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::{Assignee, ChangeCursor, Column, ProjectMeta, RunState};
use crate::file_store::frontmatter::{self, AcceptanceItem};
use crate::file_store::layout;
use crate::file_store::model::{CardView, EpicView};
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
    /// Epics in ID order. An epic with no listed card is left out.
    pub epics: Vec<ProgressEpic>,
    /// Listed cards that belong to no epic, in ID order.
    pub unassigned: Vec<ProgressCard>,
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
    pub acceptance: Count,
    pub acceptance_error: bool,
    /// The `priority` list of PLAN.md cannot be read; the cards keep ID order.
    pub priority_error: bool,
    pub cards: Vec<ProgressCard>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressCard {
    pub id: i64,
    pub title: String,
    pub assignee: Assignee,
    pub card_status: Column,
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
    let listed: Vec<&CardView> = snapshot
        .cards
        .iter()
        .filter(|card| is_listed(card))
        .collect();

    let mut epics: Vec<&EpicView> = snapshot.epics.iter().collect();
    epics.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    let mut groups = Vec::new();
    for epic in epics {
        let (priority, priority_error) = match frontmatter::priority_of(&epic.plan) {
            Ok(order) => (order, false),
            Err(_) => (Vec::new(), true),
        };
        let mut cards: Vec<&CardView> = listed
            .iter()
            .copied()
            .filter(|card| card.epic_id.as_deref() == Some(epic.id.as_str()))
            .collect();
        if cards.is_empty() {
            continue;
        }
        cards.sort_by_key(|card| (rank(&priority, card.id), card.id));
        let epic_dir = layout::epic_dir(&project_dir, &epic.id);
        groups.push(ProgressEpic {
            id: epic.id.as_str().to_string(),
            name: epic.name.clone(),
            plan_path: layout::epic_plan(&epic_dir),
            acceptance: count(&epic.acceptance),
            acceptance_error: epic.acceptance_error,
            priority_error,
            cards: cards
                .into_iter()
                .map(|card| card_of(card, &project_dir))
                .collect(),
        });
    }

    let mut unassigned: Vec<&CardView> = listed
        .iter()
        .copied()
        .filter(|card| {
            card.epic_id
                .as_deref()
                .is_none_or(|id| !snapshot.epics.iter().any(|epic| epic.id.as_str() == id))
        })
        .collect();
    unassigned.sort_by_key(|card| card.id);

    Progress {
        project: snapshot.project.clone(),
        fetched_at,
        version: snapshot.version.clone(),
        cursor: snapshot.cursor.clone(),
        epics: groups,
        unassigned: unassigned
            .into_iter()
            .map(|card| card_of(card, &project_dir))
            .collect(),
    }
}

fn is_listed(card: &CardView) -> bool {
    matches!(card.card_status, Column::Todo | Column::Doing)
        && card.agent_status != RunState::Pending
}

/// Position in the priority list; a card that is not listed comes after all
/// listed cards.
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

fn card_of(card: &CardView, project_dir: &std::path::Path) -> ProgressCard {
    ProgressCard {
        id: card.id,
        title: card.title.clone(),
        assignee: card.assignee,
        card_status: card.card_status,
        agent_status: card.agent_status,
        is_draft: card.is_draft,
        task_path: layout::task_md(&layout::task_dir(project_dir, card.id)),
        acceptance: count(&card.acceptance),
        acceptance_error: card.acceptance_error,
    }
}
