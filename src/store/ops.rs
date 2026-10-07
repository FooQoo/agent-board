//! Card maintenance, reset and restore of one project.
use chrono::Utc;
use rusqlite::params;

use super::projects::{
    ProjectStore, bump_catalog, bump_project, load_counters, load_project, name_conflict,
    require_project,
};
use super::rows::{insert_cards, load_card};
use crate::clock::{format_utc, parse_utc};
use crate::domain::{
    BoardMeta, Card, Changed, ProjectId, ProjectMeta, ValidatedBoard,
    normalize_and_validate_description, validate_project_name, validate_title,
};
use crate::error::SkanError;

/// The next history ID a restored project must hand out: above every history
/// ID the backup holds.
fn history_floor(board: &ValidatedBoard) -> Result<i64, SkanError> {
    let highest = board
        .cards
        .iter()
        .flat_map(|card| card.history.iter())
        .map(|event| event.id)
        .max()
        .unwrap_or(0);
    highest
        .checked_add(1)
        .ok_or_else(|| SkanError::DatabaseError {
            reason: "History ID overflow.".into(),
        })
}

impl ProjectStore {
    pub fn edit_card(
        &self,
        project_id: &ProjectId,
        id: i64,
        title: Option<&str>,
        description: Option<&str>,
        now: chrono::DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        let title = title.map(validate_title).transpose()?;
        let description = description
            .map(normalize_and_validate_description)
            .transpose()?;
        self.write(|conn| {
            require_project(conn, project_id)?;
            let card = load_card(conn, project_id, id)?;
            let next_title = title.as_deref().unwrap_or(&card.title);
            let next_description = description.as_deref().unwrap_or(&card.description);
            if next_title == card.title && next_description == card.description {
                return Ok(Changed {
                    value: card,
                    changed: false,
                });
            }
            conn.execute(
                "UPDATE cards SET title = ?1, description = ?2, updated_at = ?3
                 WHERE project_id = ?4 AND id = ?5",
                params![
                    next_title,
                    next_description,
                    format_utc(now),
                    project_id.as_str(),
                    id
                ],
            )?;
            bump_project(conn, project_id)?;
            Ok(Changed {
                value: load_card(conn, project_id, id)?,
                changed: true,
            })
        })
    }

    pub fn delete_card(&self, project_id: &ProjectId, id: i64) -> Result<(), SkanError> {
        self.write(|conn| {
            require_project(conn, project_id)?;
            let deleted = conn.execute(
                "DELETE FROM cards WHERE project_id = ?1 AND id = ?2",
                params![project_id.as_str(), id],
            )?;
            if deleted == 0 {
                return Err(SkanError::CardNotFound { id });
            }
            bump_project(conn, project_id)
        })
    }

    /// Empty one project's board. The ID, name, creation time and the card and
    /// history counters stay, so IDs are never reused. The revision advances
    /// only when there was something to remove.
    pub fn reset_project(&self, id: &ProjectId) -> Result<Changed<BoardMeta>, SkanError> {
        self.write(|conn| {
            let project = load_project(conn, id)?;
            let counters = load_counters(conn, id)?;
            let board = BoardMeta {
                name: project.name,
                next_card_id: counters.next_card_id,
                created_at: project.created_at,
            };
            let cards: i64 = conn.query_row(
                "SELECT COUNT(*) FROM cards WHERE project_id = ?1",
                [id.as_str()],
                |r| r.get(0),
            )?;
            if cards == 0 {
                return Ok(Changed {
                    value: board,
                    changed: false,
                });
            }
            conn.execute("DELETE FROM cards WHERE project_id = ?1", [id.as_str()])?;
            bump_project(conn, id)?;
            Ok(Changed {
                value: board,
                changed: true,
            })
        })
    }

    /// Replace one existing project's name, creation time, cards and history
    /// with a validated backup. The project keeps its ID. Its counters never go
    /// down and its revision advances by one; the catalog revision advances too
    /// when the name or creation time changes. A name another project already
    /// uses fails the whole restore.
    pub fn restore_project(
        &self,
        id: &ProjectId,
        board: &ValidatedBoard,
    ) -> Result<ProjectMeta, SkanError> {
        let name = validate_project_name(&board.metadata.name)?;
        let history_floor = history_floor(board)?;
        let created_at = format_utc(board.metadata.created_at);
        self.write(|conn| {
            let current = load_project(conn, id)?;
            let counters = load_counters(conn, id)?;
            conn.execute("DELETE FROM cards WHERE project_id = ?1", [id.as_str()])?;
            conn.execute(
                "UPDATE projects SET name = ?1, created_at = ?2, next_card_id = ?3,
                        next_history_id = ?4
                 WHERE id = ?5",
                params![
                    name,
                    created_at,
                    counters.next_card_id.max(board.metadata.next_card_id),
                    counters.next_history_id.max(history_floor),
                    id.as_str()
                ],
            )
            .map_err(|e| name_conflict(e, &name))?;
            if current.name != name || format_utc(current.created_at) != created_at {
                bump_catalog(conn)?;
            }
            insert_cards(conn, id, &board.cards)?;
            bump_project(conn, id)?;
            Ok(ProjectMeta {
                id: id.clone(),
                name: name.clone(),
                created_at: parse_utc(&created_at).unwrap_or(board.metadata.created_at),
            })
        })
    }

    /// Create a new project from a validated backup. `target_name` must equal
    /// the backup's board name; nothing is replaced. The project gets a new
    /// ID and starts at revision 0, and the catalog revision advances.
    pub fn create_from_backup(
        &self,
        target_name: &str,
        board: &ValidatedBoard,
    ) -> Result<ProjectMeta, SkanError> {
        let name = validate_project_name(target_name)?;
        if name != board.metadata.name {
            return Err(SkanError::ImportInvalid {
                file: "skan.json".into(),
                reason: format!(
                    "The backup is for \"{}\", not \"{name}\". A new project is created only when the names match.",
                    board.metadata.name
                ),
            });
        }
        let history_floor = history_floor(board)?;
        let id = ProjectId::generate()?;
        let created_at = format_utc(board.metadata.created_at);
        self.write(|conn| {
            conn.execute(
                "INSERT INTO projects (id, name, created_at, next_card_id, next_history_id, revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![
                    id.as_str(),
                    name,
                    created_at,
                    board.metadata.next_card_id,
                    history_floor
                ],
            )
            .map_err(|e| name_conflict(e, &name))?;
            bump_catalog(conn)?;
            insert_cards(conn, &id, &board.cards)?;
            Ok(ProjectMeta {
                id: id.clone(),
                name: name.clone(),
                created_at: parse_utc(&created_at).unwrap_or(board.metadata.created_at),
            })
        })
    }
}
