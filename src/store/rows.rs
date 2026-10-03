//! Mapping between SQLite rows and domain values.

use std::collections::HashMap;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use rusqlite::types::Type;
use rusqlite::{Connection, Row};

use crate::clock::{format_utc, parse_utc};
use crate::domain::{BoardMeta, Card, Column, RunState, Transition};
use crate::error::SkanError;

pub(super) const CARD_COLUMNS: &str = "id, title, description, column_name, position, run_state, \
     pending_reason, created_at, updated_at, run_state_changed_at";

fn conversion_error(
    index: usize,
    error: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, Type::Text, error.into())
}

fn text_to<T: FromStr>(index: usize, text: &str, what: &str) -> rusqlite::Result<T> {
    text.parse::<T>()
        .map_err(|_| conversion_error(index, format!("invalid {what}: {text:?}")))
}

fn time_at(row: &Row<'_>, index: usize) -> rusqlite::Result<DateTime<Utc>> {
    let text: String = row.get(index)?;
    parse_utc(&text).map_err(|e| conversion_error(index, e))
}

/// A card row without its transitions.
pub(super) fn card_from_row(row: &Row<'_>) -> rusqlite::Result<Card> {
    let column: String = row.get(3)?;
    let run_state: String = row.get(5)?;
    Ok(Card {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        column: text_to::<Column>(3, &column, "column")?,
        position: row.get(4)?,
        run_state: text_to::<RunState>(5, &run_state, "run state")?,
        pending_reason: row.get(6)?,
        created_at: time_at(row, 7)?,
        updated_at: time_at(row, 8)?,
        run_state_changed_at: time_at(row, 9)?,
        transitions: Vec::new(),
    })
}

fn transition_from_row(row: &Row<'_>, first: usize) -> rusqlite::Result<Transition> {
    let from: Option<String> = row.get(first)?;
    let to: String = row.get(first + 1)?;
    Ok(Transition {
        from: from
            .map(|f| text_to::<Column>(first, &f, "column"))
            .transpose()?,
        to: text_to::<Column>(first + 1, &to, "column")?,
        at: time_at(row, first + 2)?,
    })
}

pub(super) fn board_meta(conn: &Connection) -> Result<Option<BoardMeta>, SkanError> {
    let mut stmt =
        conn.prepare_cached("SELECT name, next_card_id, created_at FROM board WHERE id = 1")?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        None => Ok(None),
        Some(row) => Ok(Some(BoardMeta {
            name: row.get(0)?,
            next_card_id: row.get(1)?,
            created_at: time_at(row, 2)?,
        })),
    }
}

pub(super) fn require_board(conn: &Connection) -> Result<BoardMeta, SkanError> {
    board_meta(conn)?.ok_or(SkanError::NotInitialized)
}

/// A card with its transitions (oldest first), or `None` if the ID is unknown.
pub(super) fn find_card(conn: &Connection, id: i64) -> Result<Option<Card>, SkanError> {
    let sql = format!("SELECT {CARD_COLUMNS} FROM cards WHERE id = ?1");
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut rows = stmt.query([id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let mut card = card_from_row(row)?;
    drop(rows);
    let mut stmt = conn.prepare_cached(
        "SELECT from_column, to_column, at FROM transitions WHERE card_id = ?1 ORDER BY id",
    )?;
    card.transitions = stmt
        .query_map([id], |row| transition_from_row(row, 0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(card))
}

/// All cards matching the optional filters, each with its transitions, in
/// ascending ID order.
pub(super) fn find_cards(
    conn: &Connection,
    column: Option<Column>,
    state: Option<RunState>,
) -> Result<Vec<Card>, SkanError> {
    let sql = format!(
        "SELECT {CARD_COLUMNS} FROM cards \
         WHERE (?1 IS NULL OR column_name = ?1) AND (?2 IS NULL OR run_state = ?2) \
         ORDER BY id"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let mut cards: Vec<Card> = stmt
        .query_map(
            rusqlite::params![column.map(|c| c.as_str()), state.map(|s| s.as_str())],
            card_from_row,
        )?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare_cached(
        "SELECT card_id, from_column, to_column, at FROM transitions ORDER BY card_id, id",
    )?;
    let mut by_card: HashMap<i64, Vec<Transition>> = HashMap::new();
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let card_id: i64 = row.get(0)?;
        by_card
            .entry(card_id)
            .or_default()
            .push(transition_from_row(row, 1)?);
    }
    for card in &mut cards {
        card.transitions = by_card.remove(&card.id).unwrap_or_default();
    }
    Ok(cards)
}

pub(super) fn insert_card(conn: &Connection, card: &Card) -> Result<(), SkanError> {
    let mut stmt = conn.prepare_cached(&format!(
        "INSERT INTO cards ({CARD_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
    ))?;
    stmt.execute(rusqlite::params![
        card.id,
        card.title,
        card.description,
        card.column.as_str(),
        card.position,
        card.run_state.as_str(),
        card.pending_reason,
        format_utc(card.created_at),
        format_utc(card.updated_at),
        format_utc(card.run_state_changed_at),
    ])?;
    for transition in &card.transitions {
        insert_transition(conn, card.id, transition.from, transition.to, transition.at)?;
    }
    Ok(())
}

pub(super) fn insert_transition(
    conn: &Connection,
    card_id: i64,
    from: Option<Column>,
    to: Column,
    at: DateTime<Utc>,
) -> Result<(), SkanError> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO transitions (card_id, from_column, to_column, at) VALUES (?1, ?2, ?3, ?4)",
    )?;
    stmt.execute(rusqlite::params![
        card_id,
        from.map(|c| c.as_str()),
        to.as_str(),
        format_utc(at)
    ])?;
    Ok(())
}

pub(super) fn insert_board(conn: &Connection, board: &BoardMeta) -> Result<(), SkanError> {
    conn.execute(
        "INSERT INTO board (id, name, next_card_id, created_at) VALUES (1, ?1, ?2, ?3)",
        rusqlite::params![board.name, board.next_card_id, format_utc(board.created_at)],
    )?;
    Ok(())
}

pub(super) fn delete_everything(conn: &Connection) -> Result<(), SkanError> {
    conn.execute_batch("DELETE FROM transitions; DELETE FROM cards; DELETE FROM board;")?;
    Ok(())
}
