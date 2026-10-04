//! Board lifecycle and card maintenance operations.
use chrono::{DateTime, Utc};
use rusqlite::params;

use super::{
    Store,
    rows::{board_meta, delete_everything, insert_board, require_board},
};
use crate::domain::{BoardMeta, Changed, validate_board_name};
use crate::error::SkanError;

impl Store {
    pub fn board(&self) -> Result<Option<BoardMeta>, SkanError> {
        self.read(board_meta)
    }

    pub fn create_board(&self, name: &str, now: DateTime<Utc>) -> Result<BoardMeta, SkanError> {
        let name = validate_board_name(name)?;
        self.write(|conn| {
            if board_meta(conn)?.is_some() {
                return Err(SkanError::DatabaseError {
                    reason: "A board already exists.".into(),
                });
            }
            let board = BoardMeta {
                name,
                next_card_id: 1,
                created_at: now,
            };
            insert_board(conn, &board)?;
            Ok(board)
        })
    }

    pub fn reset_board(&self, name: &str, now: DateTime<Utc>) -> Result<BoardMeta, SkanError> {
        let name = validate_board_name(name)?;
        self.write(|conn| {
            let revision: i64 = conn.query_row(
                "SELECT COALESCE((SELECT revision FROM board WHERE id=1),0)",
                [],
                |row| row.get(0),
            )?;
            let next_revision =
                revision
                    .checked_add(1)
                    .ok_or_else(|| SkanError::DatabaseError {
                        reason: "Board revision overflow.".into(),
                    })?;
            delete_everything(conn)?;
            let board = BoardMeta {
                name,
                next_card_id: 1,
                created_at: now,
            };
            insert_board(conn, &board)?;
            conn.execute("UPDATE board SET revision=?1 WHERE id=1", [next_revision])?;
            Ok(board)
        })
    }

    pub fn edit_card(
        &self,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<crate::domain::Card>, SkanError> {
        let title = title.map(crate::domain::validate_title).transpose()?;
        let description = description
            .map(crate::domain::normalize_and_validate_description)
            .transpose()?;
        self.write(|conn| {
            require_board(conn)?;
            let card = super::work::load_card(conn, id)?;
            let next_title = title.as_deref().unwrap_or(&card.title);
            let next_description = description.as_deref().unwrap_or(&card.description);
            if next_title == card.title && next_description == card.description {
                return Ok(Changed {
                    value: card,
                    changed: false,
                });
            }
            conn.execute(
                "UPDATE cards SET title=?1, description=?2, updated_at=?3 WHERE id=?4",
                params![
                    next_title,
                    next_description,
                    crate::clock::format_utc(now),
                    id
                ],
            )?;
            super::work::bump(conn)?;
            Ok(Changed {
                value: super::work::load_card(conn, id)?,
                changed: true,
            })
        })
    }

    pub fn delete_card(&self, id: i64) -> Result<(), SkanError> {
        self.write(|conn| {
            require_board(conn)?;
            let deleted = conn.execute("DELETE FROM cards WHERE id=?1", [id])?;
            if deleted == 0 {
                return Err(SkanError::CardNotFound { id });
            }
            super::work::bump(conn)?;
            Ok(())
        })
    }
}
