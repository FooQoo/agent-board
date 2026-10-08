//! Versioned Agent Board backup format and validation.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::{
    domain::{
        Attachment, AttachmentData, BoardMeta, BoardSnapshot, Card, Column, HistoryKind, RunState,
        ValidatedAttachment, ValidatedBoard, normalize_and_validate_description,
        validate_attachment, validate_project_name, validate_title, validate_work_reason,
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
    #[serde(default)]
    pub attachments: Vec<BackupAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupAttachment {
    pub card_id: i64,
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size: i64,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub data: String,
}

impl Backup {
    /// The backup of one project's board. The project ID, revision and cursor
    /// are not part of the file.
    pub fn from_snapshot(snapshot: BoardSnapshot) -> Self {
        Self {
            format: "skan-board".into(),
            version: 3,
            board: snapshot.board,
            cards: snapshot.cards,
            attachments: Vec::new(),
        }
    }

    pub fn from_snapshot_with_attachments(
        snapshot: BoardSnapshot,
        attachments: Vec<(i64, AttachmentData)>,
    ) -> Self {
        let mut backup = Self::from_snapshot(snapshot);
        backup.attachments = attachments
            .into_iter()
            .map(|(card_id, data)| BackupAttachment {
                card_id,
                id: data.metadata.id,
                name: data.metadata.name,
                media_type: data.metadata.media_type,
                size: data.metadata.size,
                created_at: data.metadata.created_at,
                data: STANDARD.encode(data.bytes),
            })
            .collect();
        backup
    }

    /// Check the whole backup. The result holds only what can be restored:
    /// the board metadata and the cards.
    pub fn validate(self) -> Result<ValidatedBoard, SkanError> {
        let invalid = |reason: &str| SkanError::ImportInvalid {
            file: "skan.json".into(),
            reason: reason.into(),
        };
        if self.format != "skan-board" || self.version != 3 {
            return Err(invalid("Only skan-board version 3 is supported."));
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
            if card.is_draft && card.agent_status != RunState::Idle {
                return Err(invalid("A draft card must have agentStatus idle."));
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
        for attachment in &self.attachments {
            let card = self
                .cards
                .iter()
                .find(|card| card.id == attachment.card_id)
                .ok_or_else(|| invalid("Attachment refers to a missing card."))?;
            if !card.attachments.iter().any(|a| {
                a.id == attachment.id
                    && a.name == attachment.name
                    && a.media_type == attachment.media_type
                    && a.size == attachment.size
                    && a.created_at == attachment.created_at
            }) {
                return Err(invalid("Attachment metadata does not match its card."));
            }
            let bytes = STANDARD
                .decode(&attachment.data)
                .map_err(|_| invalid("Attachment data is not valid Base64."))?;
            if bytes.len() as i64 != attachment.size || attachment.size < 1 {
                return Err(invalid("Attachment size does not match its data."));
            }
            let detected = validate_attachment(&attachment.id, &attachment.name, &bytes)
                .map_err(|_| invalid("Attachment data is invalid."))?;
            if detected != attachment.media_type {
                return Err(invalid("Attachment media type does not match its data."));
            }
        }
        let mut attachment_ids = std::collections::HashSet::new();
        for attachment in &self.attachments {
            if !attachment_ids.insert((attachment.card_id, attachment.id.as_str())) {
                return Err(invalid("Attachment IDs must be unique per card."));
            }
        }
        for card in &self.cards {
            for metadata in &card.attachments {
                if !self
                    .attachments
                    .iter()
                    .any(|a| a.card_id == card.id && a.id == metadata.id)
                {
                    return Err(invalid("Every attachment metadata entry needs a payload."));
                }
            }
        }
        let attachments = self
            .attachments
            .into_iter()
            .map(|a| {
                let bytes = STANDARD.decode(a.data).expect("validated attachment data");
                ValidatedAttachment {
                    card_id: a.card_id,
                    data: AttachmentData {
                        metadata: Attachment {
                            id: a.id,
                            name: a.name,
                            media_type: a.media_type,
                            size: a.size,
                            created_at: a.created_at,
                        },
                        bytes,
                    },
                }
            })
            .collect();
        Ok(ValidatedBoard {
            metadata: self.board,
            cards: self.cards,
            attachments,
        })
    }
}
