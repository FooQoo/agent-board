use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{Column, RunState};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transition {
    pub from: Option<Column>,
    pub to: Column,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub column: Column,
    pub position: i64,
    pub run_state: RunState,
    pub pending_reason: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub updated_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_utc")]
    pub run_state_changed_at: DateTime<Utc>,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardMeta {
    pub name: String,
    pub next_card_id: i64,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardSnapshot {
    pub board: BoardMeta,
    pub cards: Vec<Card>,
}
