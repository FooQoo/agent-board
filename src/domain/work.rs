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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Created,
    Lane,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: i64,
    pub kind: HistoryKind,
    pub actor: Actor,
    pub reason: Option<String>,
    pub from_card_status: Option<Column>,
    pub to_card_status: Column,
    pub from_agent_status: Option<RunState>,
    pub to_agent_status: RunState,
    pub request_id: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeContext {
    pub actor: Actor,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCard {
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub actor: Actor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changed<T> {
    pub value: T,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub assignee: Assignee,
    pub card_status: Column,
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
    pub history: Vec<HistoryEvent>,
}

/// One project's board read in a single transaction: the project, its board
/// metadata, revision, the cursor for that revision and every card with its
/// full history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub project: super::ProjectMeta,
    pub board: super::BoardMeta,
    pub revision: i64,
    pub cursor: super::ChangeCursor,
    pub cards: Vec<Card>,
}

/// Every project's board read in one transaction: the catalog revision and one
/// [`BoardSnapshot`] per project, ordered by project name (binary order, as
/// `project ls` lists them).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllBoardsSnapshot {
    pub catalog_revision: i64,
    pub projects: Vec<BoardSnapshot>,
}

/// A snapshot with the time it was fetched, as the CLI, the hook and wait
/// print it. The fetch time is added by the reader, never stored.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedSnapshot<'a> {
    pub fetched_at: String,
    #[serde(flatten)]
    pub snapshot: &'a BoardSnapshot,
}

/// A backup that passed every check, ready to be restored. It carries only
/// what the backup file holds: no project ID, revision or cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedBoard {
    pub metadata: super::BoardMeta,
    pub cards: Vec<Card>,
}
