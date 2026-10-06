//! Versioned Agent Board backup format and validation.
use serde::{Deserialize, Serialize};

use crate::{
    domain::{
        BoardMeta, BoardSnapshot, Card, Column, HistoryKind, RunState, ValidatedBoard,
        normalize_and_validate_description, validate_project_name, validate_title,
        validate_work_reason,
    },
    error::SkanError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub board: BoardMeta,
    pub cards: Vec<Card>,
}

impl Backup {
    /// The backup of one project's board. The project ID, revision and cursor
    /// are not part of the file.
    pub fn from_snapshot(snapshot: BoardSnapshot) -> Self {
        Self {
            format: "skan-board".into(),
            version: 2,
            board: snapshot.board,
            cards: snapshot.cards,
        }
    }

    /// Check the whole backup. The result holds only what can be restored:
    /// the board metadata and the cards.
    pub fn validate(self) -> Result<ValidatedBoard, SkanError> {
        let invalid = |reason: &str| SkanError::ImportInvalid {
            file: "skan.json".into(),
            reason: reason.into(),
        };
        if self.format != "skan-board" || self.version != 2 {
            return Err(invalid("Only skan-board version 2 is supported."));
        }
        // The board name becomes the project name, so it follows that rule.
        let board_name = validate_project_name(&self.board.name)
            .map_err(|_| invalid("Board name is invalid."))?;
        if board_name != self.board.name || self.board.next_card_id < 1 {
            return Err(invalid("Board metadata is invalid."));
        }
        let mut ids = std::collections::HashSet::new();
        let mut history_ids = std::collections::HashSet::new();
        let mut positions = std::collections::HashSet::new();
        let max_id = self.cards.iter().map(|c| c.id).max().unwrap_or(0);
        if self.board.next_card_id <= max_id {
            return Err(invalid("nextCardId must be greater than every card ID."));
        }
        for card in &self.cards {
            if card.id < 1
                || !ids.insert(card.id)
                || card.position < 1
                || !positions.insert((card.card_status, card.position))
            {
                return Err(invalid(
                    "Card IDs and lane positions must be unique and positive.",
                ));
            }
            validate_title(&card.title).map_err(|_| invalid("Card title is invalid."))?;
            normalize_and_validate_description(&card.description)
                .map_err(|_| invalid("Card description is invalid."))?;
            if (card.assignee == crate::domain::Assignee::Human
                || card.card_status != Column::Doing)
                && card.agent_status != RunState::Idle
            {
                return Err(invalid(
                    "Card agentStatus is invalid for its assignee or cardStatus.",
                ));
            }
            if card.history.is_empty() {
                return Err(invalid("Every card must include its created history."));
            }
            let mut lane = Column::Todo;
            let mut state = RunState::Idle;
            let mut pending: Option<&str> = None;
            let mut pending_reason: Option<&str> = None;
            for (i, event) in card.history.iter().enumerate() {
                if event.id < 1 || !history_ids.insert(event.id) {
                    return Err(invalid("History IDs must be unique and positive."));
                }
                if i == 0 {
                    if event.kind != HistoryKind::Created
                        || event.from_card_status.is_some()
                        || event.from_agent_status.is_some()
                        || event.reason.is_some()
                        || event.to_card_status != Column::Todo
                        || event.to_agent_status != RunState::Idle
                    {
                        return Err(invalid("History must begin with a valid created event."));
                    }
                } else {
                    let reason = event
                        .reason
                        .as_deref()
                        .ok_or_else(|| invalid("Every change history requires a reason."))?;
                    validate_work_reason(reason)
                        .map_err(|_| invalid("History reason is invalid."))?;
                    if event.from_card_status != Some(lane)
                        || event.from_agent_status != Some(state)
                    {
                        return Err(invalid("History changes are not continuous."));
                    }
                    match event.kind {
                        HistoryKind::Created => {
                            return Err(invalid("Created history may appear only first."));
                        }
                        HistoryKind::Lane => {
                            if event.to_card_status == lane {
                                return Err(invalid("Lane history must change the card status."));
                            }
                            if event.to_agent_status != RunState::Idle {
                                return Err(invalid(
                                    "Lane changes must reset agentStatus to idle.",
                                ));
                            }
                            lane = event.to_card_status;
                            state = RunState::Idle;
                            pending = None;
                        }
                        HistoryKind::Agent => {
                            if event.to_card_status != lane
                                || event.to_agent_status == state
                                || (card.assignee == crate::domain::Assignee::Human
                                    && event.to_agent_status != RunState::Idle)
                                || (lane != Column::Doing
                                    && event.to_agent_status != RunState::Idle)
                            {
                                return Err(invalid("Agent status change is invalid."));
                            }
                            match event.to_agent_status {
                                RunState::Pending => {
                                    pending = event.request_id.as_deref();
                                    pending_reason = Some(reason);
                                    if pending.is_none() {
                                        return Err(invalid(
                                            "Pending history must have a request ID.",
                                        ));
                                    }
                                }
                                RunState::Idle if state == RunState::Pending => {
                                    if event.request_id.as_deref() != pending {
                                        return Err(invalid(
                                            "Answer history does not match the pending request.",
                                        ));
                                    }
                                    pending = None;
                                    pending_reason = None;
                                }
                                _ => {
                                    if event.request_id.is_some() {
                                        return Err(invalid("Unexpected request ID in history."));
                                    }
                                    pending = None;
                                    pending_reason = None;
                                }
                            }
                            state = event.to_agent_status;
                        }
                    }
                }
            }
            if lane != card.card_status
                || state != card.agent_status
                || pending != card.pending_request_id.as_deref()
            {
                return Err(invalid("History does not match the current card state."));
            }
            if (state == RunState::Pending) != card.pending_reason.is_some()
                || pending_reason != card.pending_reason.as_deref()
            {
                return Err(invalid("Pending reason does not match current state."));
            }
        }
        Ok(ValidatedBoard {
            metadata: self.board,
            cards: self.cards,
        })
    }
}
