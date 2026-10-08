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

#[derive(Debug, Clone, Serialize)]
pub struct Backup {
    pub format: String,
    pub version: u32,
    pub board: BoardMeta,
    pub cards: Vec<Card>,
    #[serde(default)]
    pub attachments: Vec<BackupAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupInput {
    format: String,
    version: u32,
    board: BoardMeta,
    cards: Vec<Card>,
    #[serde(default)]
    attachments: Vec<BackupAttachment>,
}

impl<'de> Deserialize<'de> for Backup {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let mut input = BackupInput::deserialize(deserializer)?;
        match (input.format.as_str(), input.version) {
            // The pre-archive export is accepted as the first version of the
            // new series. Cards did not have archivedAt, so serde's default
            // gives every imported card its explicit NULL meaning.
            ("skan-board", 3) | ("agboard-board", 1) => {
                for card in &mut input.cards {
                    card.archived_at = None;
                }
                input.format = "agboard-board".into();
                input.version = 2;
            }
            ("agboard-board", 2) => {}
            ("skan-board", 1 | 2) => {
                return Err(serde::de::Error::custom(
                    "old skan-board versions are not supported",
                ));
            }
            _ => {
                return Err(serde::de::Error::custom("unknown or future backup format"));
            }
        }
        Ok(Self {
            format: input.format,
            version: input.version,
            board: input.board,
            cards: input.cards,
            attachments: input.attachments,
        })
    }
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

    /// Build the current export format. The legacy constructor remains useful
    /// for fixtures representing the version 3 input format.
    pub fn from_export_snapshot_with_attachments(
        snapshot: BoardSnapshot,
        attachments: Vec<(i64, AttachmentData)>,
    ) -> Self {
        let mut backup = Self::from_snapshot_with_attachments(snapshot, attachments);
        backup.format = "agboard-board".into();
        backup.version = 2;
        backup
    }

    /// Check the whole backup. The result holds only what can be restored:
    /// the board metadata and the cards.
    pub fn validate(self) -> Result<ValidatedBoard, SkanError> {
        let invalid = |reason: &str| SkanError::ImportInvalid {
            file: "skan.json".into(),
            reason: reason.into(),
        };
        if !((self.format == "agboard-board" && self.version == 2)
            || (self.format == "skan-board" && self.version == 3))
        {
            return Err(invalid("Only agboard-board version 2 is supported."));
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
                || (card.archived_at.is_none()
                    && !positions.insert((card.card_status, card.position)))
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
            if card.archived_at.is_some()
                && (card.agent_status != RunState::Idle
                    || card.pending_reason.is_some()
                    || card.pending_request_id.is_some())
            {
                return Err(invalid(
                    "An archived card must be idle without a pending request.",
                ));
            }
            if card.history.is_empty() {
                return Err(invalid("Every card must include its created history."));
            }
            let mut lane = Column::Todo;
            let mut state = RunState::Idle;
            let mut pending: Option<&str> = None;
            let mut pending_reason: Option<&str> = None;
            let mut archived = false;
            let mut replayed_archived_at = None;
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
                            if archived {
                                return Err(invalid("An archived card cannot change lanes."));
                            }
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
                            if archived {
                                return Err(invalid("An archived card cannot change agent state."));
                            }
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
                        HistoryKind::Archive | HistoryKind::Restore => {
                            if event.to_card_status != lane
                                || event.to_agent_status != RunState::Idle
                                || event.from_card_status != Some(lane)
                                || event.from_agent_status != Some(state)
                            {
                                return Err(invalid("Archive history is not continuous."));
                            }
                            if event.kind == HistoryKind::Archive {
                                if archived {
                                    return Err(invalid("A card cannot be archived twice."));
                                }
                                if event.request_id.as_deref() != pending {
                                    return Err(invalid(
                                        "Archive history does not match the pending request.",
                                    ));
                                }
                                archived = true;
                                replayed_archived_at = Some(event.at);
                            } else {
                                if !archived || event.request_id.is_some() {
                                    return Err(invalid("Restore history is not continuous."));
                                }
                                archived = false;
                                replayed_archived_at = None;
                            }
                            state = RunState::Idle;
                            pending = None;
                            pending_reason = None;
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
            if archived != card.archived_at.is_some() {
                return Err(invalid("Archive history does not match archivedAt."));
            }
            if replayed_archived_at != card.archived_at {
                return Err(invalid("archivedAt does not match archive history."));
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
