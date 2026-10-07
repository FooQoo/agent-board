//! SQLite mapping for cards and history inside one project. Every statement
//! names the project: a card or history row is never addressed by its own ID
//! alone.
use std::str::FromStr;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};

use crate::clock::{format_utc, parse_utc};
use crate::domain::*;
use crate::error::SkanError;

pub(super) fn assignee_str(value: Assignee) -> &'static str {
    match value {
        Assignee::Ai => "ai",
        Assignee::Human => "human",
    }
}

pub(super) fn actor_str(value: Actor) -> &'static str {
    match value {
        Actor::Ai => "ai",
        Actor::Human => "human",
    }
}

pub(super) fn kind_str(value: HistoryKind) -> &'static str {
    match value {
        HistoryKind::Created => "created",
        HistoryKind::Lane => "lane",
        HistoryKind::Agent => "agent",
    }
}

fn conversion(
    index: usize,
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error))
}

fn parse_column(index: usize, value: &str) -> rusqlite::Result<Column> {
    Column::from_str(value).map_err(|_| {
        conversion(
            index,
            std::io::Error::other(format!("invalid card status: {value}")),
        )
    })
}

fn parse_state(index: usize, value: &str) -> rusqlite::Result<RunState> {
    RunState::from_str(value).map_err(|_| {
        conversion(
            index,
            std::io::Error::other(format!("invalid agent status: {value}")),
        )
    })
}

/// The full history of one card of one project, oldest first.
pub(super) fn load_history(
    conn: &Connection,
    project_id: &ProjectId,
    card_id: i64,
) -> Result<Vec<HistoryEvent>, SkanError> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, actor, reason, from_column, to_column, from_agent_status,
                to_agent_status, request_id, at
         FROM history WHERE project_id = ?1 AND card_id = ?2 ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![project_id.as_str(), card_id], |r| {
            let kind: String = r.get(1)?;
            let actor: String = r.get(2)?;
            let from_column: Option<String> = r.get(4)?;
            let to_column: String = r.get(5)?;
            let from_state: Option<String> = r.get(6)?;
            let to_state: String = r.get(7)?;
            let at: String = r.get(9)?;
            let kind = match kind.as_str() {
                "created" => HistoryKind::Created,
                "lane" => HistoryKind::Lane,
                "agent" => HistoryKind::Agent,
                _ => {
                    return Err(conversion(
                        1,
                        std::io::Error::other(format!("invalid history kind: {kind}")),
                    ));
                }
            };
            let actor = match actor.as_str() {
                "ai" => Actor::Ai,
                "human" => Actor::Human,
                _ => {
                    return Err(conversion(
                        2,
                        std::io::Error::other(format!("invalid actor: {actor}")),
                    ));
                }
            };
            Ok(HistoryEvent {
                id: r.get(0)?,
                kind,
                actor,
                reason: r.get(3)?,
                from_card_status: from_column.map(|s| parse_column(4, &s)).transpose()?,
                to_card_status: parse_column(5, &to_column)?,
                from_agent_status: from_state.map(|s| parse_state(6, &s)).transpose()?,
                to_agent_status: parse_state(7, &to_state)?,
                request_id: r.get(8)?,
                at: parse_utc(&at).map_err(|e| conversion(9, e))?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// One card of one project with its full history. A card of another project
/// with the same ID is invisible: the result is `card_not_found`.
pub(super) fn load_card(
    conn: &Connection,
    project_id: &ProjectId,
    id: i64,
) -> Result<Card, SkanError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, assignee, column_name, position, run_state,
                pending_reason, pending_request_id, created_at, updated_at, run_state_changed_at
         FROM cards WHERE project_id = ?1 AND id = ?2",
    )?;
    let mut card = stmt
        .query_row(params![project_id.as_str(), id], |r| {
            let assignee: String = r.get(3)?;
            let column: String = r.get(4)?;
            let state: String = r.get(6)?;
            let assignee = match assignee.as_str() {
                "ai" => Assignee::Ai,
                "human" => Assignee::Human,
                _ => {
                    return Err(conversion(
                        3,
                        std::io::Error::other(format!("invalid assignee: {assignee}")),
                    ));
                }
            };
            let time = |i| -> rusqlite::Result<DateTime<Utc>> {
                let text: String = r.get(i)?;
                parse_utc(&text).map_err(|e| conversion(i, e))
            };
            Ok(Card {
                id: r.get(0)?,
                title: r.get(1)?,
                description: r.get(2)?,
                assignee,
                card_status: parse_column(4, &column)?,
                position: r.get(5)?,
                agent_status: parse_state(6, &state)?,
                pending_reason: r.get(7)?,
                pending_request_id: r.get(8)?,
                created_at: time(9)?,
                updated_at: time(10)?,
                agent_status_changed_at: time(11)?,
                history: Vec::new(),
            })
        })
        .map_err(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                SkanError::CardNotFound { id }
            } else {
                e.into()
            }
        })?;
    card.history = load_history(conn, project_id, id)?;
    Ok(card)
}

/// Every card of one project in ID order.
pub(super) fn load_cards(
    conn: &Connection,
    project_id: &ProjectId,
) -> Result<Vec<Card>, SkanError> {
    let ids = {
        let mut stmt = conn.prepare("SELECT id FROM cards WHERE project_id = ?1 ORDER BY id")?;
        let rows = stmt.query_map([project_id.as_str()], |r| r.get::<_, i64>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    ids.into_iter()
        .map(|id| load_card(conn, project_id, id))
        .collect()
}

/// Insert one history event with its explicit ID.
pub(super) fn insert_event(
    conn: &Connection,
    project_id: &ProjectId,
    card_id: i64,
    event: &HistoryEvent,
) -> Result<(), SkanError> {
    conn.execute(
        "INSERT INTO history (project_id, id, card_id, kind, actor, reason, from_column,
                              to_column, from_agent_status, to_agent_status, request_id, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            project_id.as_str(),
            event.id,
            card_id,
            kind_str(event.kind),
            actor_str(event.actor),
            event.reason,
            event.from_card_status.map(|v| v.as_str()),
            event.to_card_status.as_str(),
            event.from_agent_status.map(|v| v.as_str()),
            event.to_agent_status.as_str(),
            event.request_id,
            format_utc(event.at),
        ],
    )?;
    Ok(())
}

/// Insert cards with their histories, exactly as given, into one project.
pub(super) fn insert_cards(
    conn: &Connection,
    project_id: &ProjectId,
    cards: &[Card],
) -> Result<(), SkanError> {
    for card in cards {
        conn.execute(
            "INSERT INTO cards (project_id, id, title, description, assignee, column_name, position,
                                run_state, pending_reason, pending_request_id, created_at,
                                updated_at, run_state_changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                project_id.as_str(),
                card.id,
                card.title,
                card.description,
                assignee_str(card.assignee),
                card.card_status.as_str(),
                card.position,
                card.agent_status.as_str(),
                card.pending_reason,
                card.pending_request_id,
                format_utc(card.created_at),
                format_utc(card.updated_at),
                format_utc(card.agent_status_changed_at),
            ],
        )?;
        for event in &card.history {
            insert_event(conn, project_id, card.id, event)?;
        }
    }
    Ok(())
}
