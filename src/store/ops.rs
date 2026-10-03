//! The board and card operations of [`Store`].

use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};

use crate::clock::format_utc;
use crate::domain::{
    BoardMeta, BoardSnapshot, Card, Column, RunState, check_run_state,
    normalize_and_validate_description, sort_cards, validate_board_name, validate_reason,
    validate_title,
};
use crate::error::SkanError;

use super::Store;
use super::rows::{
    board_meta, delete_everything, find_card, find_cards, insert_board, insert_card,
    insert_transition, require_board,
};

fn require_card(conn: &Connection, id: i64) -> Result<Card, SkanError> {
    find_card(conn, id)?.ok_or(SkanError::CardNotFound { id })
}

fn reload(conn: &Connection, id: i64) -> Result<Card, SkanError> {
    require_card(conn, id)
}

impl Store {
    /// The board, or `None` if the store is not initialized.
    pub fn board(&self) -> Result<Option<BoardMeta>, SkanError> {
        self.read(board_meta)
    }

    /// Create the board. A board that already exists is an internal error:
    /// callers check first and ask a human before replacing.
    pub fn create_board(&self, name: &str, now: DateTime<Utc>) -> Result<BoardMeta, SkanError> {
        let name = validate_board_name(name)?;
        self.write(|conn| {
            if board_meta(conn)?.is_some() {
                return Err(SkanError::DatabaseError {
                    reason: "A board already exists.".to_string(),
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

    /// Delete every card and transition and start a new board whose card IDs
    /// begin at 1. Works whether or not a board exists.
    pub fn reset_board(&self, name: &str, now: DateTime<Utc>) -> Result<BoardMeta, SkanError> {
        let name = validate_board_name(name)?;
        self.write(|conn| {
            delete_everything(conn)?;
            let board = BoardMeta {
                name,
                next_card_id: 1,
                created_at: now,
            };
            insert_board(conn, &board)?;
            Ok(board)
        })
    }

    /// Add an idle card to the end of Todo.
    pub fn add_card(
        &self,
        title: &str,
        description: &str,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        let title = validate_title(title)?;
        let description = normalize_and_validate_description(description)?;
        self.write(|conn| {
            let board = require_board(conn)?;
            let id = board.next_card_id;
            let position: i64 = conn.query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM cards WHERE column_name = 'todo'",
                [],
                |row| row.get(0),
            )?;
            let card = Card {
                id,
                title,
                description,
                column: Column::Todo,
                position,
                run_state: RunState::Idle,
                pending_reason: None,
                created_at: now,
                updated_at: now,
                run_state_changed_at: now,
                transitions: vec![crate::domain::Transition {
                    from: None,
                    to: Column::Todo,
                    at: now,
                }],
            };
            insert_card(conn, &card)?;
            conn.execute("UPDATE board SET next_card_id = ?1 WHERE id = 1", [id + 1])?;
            Ok(card)
        })
    }

    /// Change the given fields. The flag is `false` when nothing differed, in
    /// which case nothing is written.
    pub fn edit_card(
        &self,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<(Card, bool), SkanError> {
        let title = title.map(validate_title).transpose()?;
        let description = description
            .map(normalize_and_validate_description)
            .transpose()?;
        self.write(|conn| {
            require_board(conn)?;
            let card = require_card(conn, id)?;
            let new_title = title.unwrap_or_else(|| card.title.clone());
            let new_description = description.unwrap_or_else(|| card.description.clone());
            if new_title == card.title && new_description == card.description {
                return Ok((card, false));
            }
            conn.execute(
                "UPDATE cards SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
                params![new_title, new_description, format_utc(now), id],
            )?;
            Ok((reload(conn, id)?, true))
        })
    }

    /// Move a card to the end of `column`. Moving to Todo or Done resets the
    /// run state to idle; moving to the column it is already in changes nothing.
    pub fn move_card(
        &self,
        id: i64,
        column: Column,
        now: DateTime<Utc>,
    ) -> Result<(Card, bool), SkanError> {
        self.write(|conn| {
            require_board(conn)?;
            let card = require_card(conn, id)?;
            if card.column == column {
                return Ok((card, false));
            }
            let position: i64 = conn.query_row(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM cards WHERE column_name = ?1",
                [column.as_str()],
                |row| row.get(0),
            )?;
            let reset_run_state = column != Column::Doing && card.run_state != RunState::Idle;
            if reset_run_state {
                conn.execute(
                    "UPDATE cards SET column_name = ?1, position = ?2, updated_at = ?3, \
                     run_state = 'idle', pending_reason = NULL, run_state_changed_at = ?3 \
                     WHERE id = ?4",
                    params![column.as_str(), position, format_utc(now), id],
                )?;
            } else {
                conn.execute(
                    "UPDATE cards SET column_name = ?1, position = ?2, updated_at = ?3 \
                     WHERE id = ?4",
                    params![column.as_str(), position, format_utc(now), id],
                )?;
            }
            insert_transition(conn, id, Some(card.column), column, now)?;
            Ok((reload(conn, id)?, true))
        })
    }

    /// Report a run state. `running` and `pending` need the card to be in
    /// Doing; a reason is only for `pending`.
    ///
    /// Checks run in this order: board exists, card exists, run-state rules,
    /// then the reason's format.
    pub fn set_run_state(
        &self,
        id: i64,
        state: RunState,
        reason: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<(Card, bool), SkanError> {
        self.write(|conn| {
            require_board(conn)?;
            let card = require_card(conn, id)?;
            check_run_state(card.column, state, reason)
                .map_err(|violation| violation.into_error(id, card.column, state))?;
            let reason = reason.map(validate_reason).transpose()?;
            if card.run_state == state && card.pending_reason == reason {
                return Ok((card, false));
            }
            // The reason alone changing counts as a change, but the state's own
            // timestamp only moves when the state itself changes.
            let state_changed_at = if card.run_state == state {
                card.run_state_changed_at
            } else {
                now
            };
            conn.execute(
                "UPDATE cards SET run_state = ?1, pending_reason = ?2, updated_at = ?3, \
                 run_state_changed_at = ?4 WHERE id = ?5",
                params![
                    state.as_str(),
                    reason,
                    format_utc(now),
                    format_utc(state_changed_at),
                    id
                ],
            )?;
            Ok((reload(conn, id)?, true))
        })
    }

    /// Delete a card and its transitions. Its ID is never reused.
    pub fn delete_card(&self, id: i64) -> Result<(), SkanError> {
        self.write(|conn| {
            require_board(conn)?;
            let deleted = conn.execute("DELETE FROM cards WHERE id = ?1", [id])?;
            if deleted == 0 {
                return Err(SkanError::CardNotFound { id });
            }
            Ok(())
        })
    }

    pub fn card(&self, id: i64) -> Result<Card, SkanError> {
        self.read(|conn| {
            require_board(conn)?;
            require_card(conn, id)
        })
    }

    /// Cards in display order, optionally filtered by column and run state.
    pub fn list_cards(
        &self,
        column: Option<Column>,
        state: Option<RunState>,
    ) -> Result<Vec<Card>, SkanError> {
        self.read(|conn| {
            require_board(conn)?;
            let mut cards = find_cards(conn, column, state)?;
            sort_cards(&mut cards);
            Ok(cards)
        })
    }

    /// The whole board in one read transaction. Cards are in ascending ID order
    /// (the export order), not display order.
    pub fn snapshot(&self) -> Result<BoardSnapshot, SkanError> {
        self.read(|conn| {
            let board = require_board(conn)?;
            let cards = find_cards(conn, None, None)?;
            Ok(BoardSnapshot { board, cards })
        })
    }

    /// Delete everything and restore `snapshot` in one transaction. The caller
    /// has validated the snapshot; only database constraints are checked here.
    pub fn replace_all(&self, snapshot: &BoardSnapshot) -> Result<(), SkanError> {
        self.write(|conn| {
            delete_everything(conn)?;
            insert_board(conn, &snapshot.board)?;
            for card in &snapshot.cards {
                insert_card(conn, card)?;
            }
            Ok(())
        })
    }
}
