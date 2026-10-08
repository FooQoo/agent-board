use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};

use super::projects::{ProjectStore, bump_project, load_counters, load_project, require_project};
use super::rows::{insert_event, load_card, load_cards_all, load_cards_archived};
use crate::clock::format_utc;
use crate::domain::*;
use crate::error::SkanError;

const ARCHIVE_REASON: &str = "Archived by user.";
const RESTORE_REASON: &str = "Restored by user.";

fn event_id(conn: &Connection, project: &ProjectId) -> Result<i64, SkanError> {
    let id = load_counters(conn, project)?.next_history_id;
    conn.execute(
        "UPDATE projects SET next_history_id = next_history_id + 1 WHERE id = ?1",
        [project.as_str()],
    )?;
    Ok(id)
}

fn append_archive_event(
    conn: &Connection,
    project: &ProjectId,
    card: &Card,
    kind: HistoryKind,
    now: DateTime<Utc>,
) -> Result<(), SkanError> {
    let archive = kind == HistoryKind::Archive;
    let event = HistoryEvent {
        id: event_id(conn, project)?,
        kind,
        actor: Actor::Human,
        reason: Some(if archive {
            ARCHIVE_REASON.into()
        } else {
            RESTORE_REASON.into()
        }),
        from_card_status: Some(card.card_status),
        to_card_status: card.card_status,
        from_agent_status: Some(card.agent_status),
        to_agent_status: RunState::Idle,
        request_id: card.pending_request_id.clone(),
        at: now,
    };
    insert_event(conn, project, card.id, &event)
}

fn lane_end_active(conn: &Connection, project: &ProjectId, lane: Column) -> Result<i64, SkanError> {
    let max: i64 = conn.query_row("SELECT COALESCE(MAX(position), 0) FROM cards WHERE project_id = ?1 AND column_name = ?2 AND archived_at IS NULL", params![project.as_str(), lane.as_str()], |r| r.get(0))?;
    max.checked_add(1).ok_or_else(|| SkanError::DatabaseError {
        reason: "Lane position overflow.".into(),
    })
}

impl ProjectStore {
    pub fn archive_card(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        self.write(|conn| {
            require_project(conn, project)?;
            let card = load_card(conn, project, id)?;
            if card.archived_at.is_some() { return Ok(Changed { value: card, changed: false }); }
            conn.execute("UPDATE cards SET archived_at = ?1, run_state = 'idle', pending_reason = NULL, pending_request_id = NULL, updated_at = ?1, run_state_changed_at = CASE WHEN run_state != 'idle' THEN ?1 ELSE run_state_changed_at END WHERE project_id = ?2 AND id = ?3", params![format_utc(now), project.as_str(), id])?;
            append_archive_event(conn, project, &card, HistoryKind::Archive, now)?;
            bump_project(conn, project)?;
            Ok(Changed { value: load_card(conn, project, id)?, changed: true })
        })
    }

    pub fn restore_card(
        &self,
        project: &ProjectId,
        id: i64,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        self.write(|conn| {
            require_project(conn, project)?;
            let card = load_card(conn, project, id)?;
            if card.archived_at.is_none() { return Ok(Changed { value: card, changed: false }); }
            let position = lane_end_active(conn, project, card.card_status)?;
            conn.execute("UPDATE cards SET archived_at = NULL, position = ?1, updated_at = ?2 WHERE project_id = ?3 AND id = ?4", params![position, format_utc(now), project.as_str(), id])?;
            append_archive_event(conn, project, &card, HistoryKind::Restore, now)?;
            bump_project(conn, project)?;
            Ok(Changed { value: load_card(conn, project, id)?, changed: true })
        })
    }

    pub fn archive_done(
        &self,
        project: &ProjectId,
        ids: &[i64],
        now: DateTime<Utc>,
    ) -> Result<Changed<BulkArchiveResult>, SkanError> {
        if ids.is_empty()
            || ids.iter().any(|id| *id <= 0)
            || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        {
            return Err(SkanError::InvalidValue {
                field: "ids".into(),
                reason: "IDs must be a non-empty list of unique positive integers.".into(),
            });
        }
        self.write(|conn| {
            require_project(conn, project)?;
            let mut cards = Vec::with_capacity(ids.len());
            for id in ids {
                let card = load_card(conn, project, *id).map_err(|_| SkanError::ArchiveTargetsChanged)?;
                if card.archived_at.is_none() && card.card_status != Column::Done { return Err(SkanError::ArchiveTargetsChanged); }
                cards.push(card);
            }
            let target_ids = cards.iter().map(|card| card.id).collect::<Vec<_>>();
            let mut changed = false;
            let mut count = 0;
            for card in cards {
                if card.archived_at.is_some() { continue; }
                conn.execute("UPDATE cards SET archived_at = ?1, run_state = 'idle', pending_reason = NULL, pending_request_id = NULL, updated_at = ?1, run_state_changed_at = CASE WHEN run_state != 'idle' THEN ?1 ELSE run_state_changed_at END WHERE project_id = ?2 AND id = ?3", params![format_utc(now), project.as_str(), card.id])?;
                append_archive_event(conn, project, &card, HistoryKind::Archive, now)?;
                changed = true; count += 1;
            }
            if changed { bump_project(conn, project)?; }
            let result = BulkArchiveResult { cards: target_ids.iter().map(|id| load_card(conn, project, *id)).collect::<Result<Vec<_>, _>>()?, archived_count: count };
            Ok(Changed { value: result, changed })
        })
    }

    pub fn archive_snapshot(&self, project: &ProjectId) -> Result<BoardSnapshot, SkanError> {
        self.read(|conn| {
            let project_meta = load_project(conn, project)?;
            let counters = load_counters(conn, project)?;
            Ok(BoardSnapshot {
                board: BoardMeta {
                    name: project_meta.name.clone(),
                    next_card_id: counters.next_card_id,
                    created_at: project_meta.created_at,
                },
                project: project_meta,
                revision: counters.revision,
                cursor: ChangeCursor::new(project.clone(), counters.revision)?,
                cards: load_cards_archived(conn, project)?,
            })
        })
    }

    pub fn export_snapshot(&self, project: &ProjectId) -> Result<BoardSnapshot, SkanError> {
        self.read(|conn| {
            let project_meta = load_project(conn, project)?;
            let counters = load_counters(conn, project)?;
            Ok(BoardSnapshot {
                board: BoardMeta {
                    name: project_meta.name.clone(),
                    next_card_id: counters.next_card_id,
                    created_at: project_meta.created_at,
                },
                project: project_meta,
                revision: counters.revision,
                cursor: ChangeCursor::new(project.clone(), counters.revision)?,
                cards: load_cards_all(conn, project)?,
            })
        })
    }

    pub fn delete_archived_card(&self, project: &ProjectId, id: i64) -> Result<(), SkanError> {
        self.write(|conn| {
            require_project(conn, project)?;
            let card = load_card(conn, project, id)?;
            if card.archived_at.is_none() {
                return Err(SkanError::CardNotArchived { id });
            }
            conn.execute(
                "DELETE FROM cards WHERE project_id = ?1 AND id = ?2",
                params![project.as_str(), id],
            )?;
            bump_project(conn, project)
        })
    }
}
