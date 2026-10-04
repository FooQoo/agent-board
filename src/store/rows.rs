//! SQLite mapping for board metadata. Cards and history live in `work.rs`.
use chrono::{DateTime, Utc};
use rusqlite::{Connection, Row};

use crate::clock::{format_utc, parse_utc};
use crate::domain::BoardMeta;
use crate::error::SkanError;

fn time_at(row: &Row<'_>, index: usize) -> rusqlite::Result<DateTime<Utc>> {
    let text: String = row.get(index)?;
    parse_utc(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
    })
}

pub(super) fn board_meta(conn: &Connection) -> Result<Option<BoardMeta>, SkanError> {
    let mut stmt =
        conn.prepare_cached("SELECT name, next_card_id, created_at FROM board WHERE id=1")?;
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

pub(super) fn insert_board(conn: &Connection, board: &BoardMeta) -> Result<(), SkanError> {
    conn.execute(
        "INSERT INTO board (id, name, next_card_id, created_at) VALUES (1, ?1, ?2, ?3)",
        rusqlite::params![board.name, board.next_card_id, format_utc(board.created_at)],
    )?;
    Ok(())
}

pub(super) fn delete_everything(conn: &Connection) -> Result<(), SkanError> {
    conn.execute_batch("DELETE FROM cards; DELETE FROM board;")?;
    Ok(())
}
