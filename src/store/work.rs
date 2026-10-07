//! Card operations of one project. Every mutation records its audit event and
//! advances the project's revision in the same immediate transaction, and every
//! statement is limited to the project it was given.
use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};

use super::projects::{
    ProjectStore, bump_project, load_catalog, load_counters, load_project, require_project,
};
use super::rows::{assignee_str, insert_event, load_card, load_cards};
use crate::{clock::format_utc, domain::*, error::SkanError};

fn next_request_id() -> Result<String, SkanError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// A history event before it receives its ID.
struct EventDraft<'a> {
    kind: HistoryKind,
    actor: Actor,
    reason: Option<&'a str>,
    from_card_status: Option<Column>,
    to_card_status: Column,
    from_agent_status: Option<RunState>,
    to_agent_status: RunState,
    request_id: Option<&'a str>,
    at: DateTime<Utc>,
}

/// Take the project's next history ID and advance the counter.
fn take_history_id(conn: &Connection, project_id: &ProjectId) -> Result<i64, SkanError> {
    let id = load_counters(conn, project_id)?.next_history_id;
    let next = id.checked_add(1).ok_or_else(|| SkanError::DatabaseError {
        reason: "History ID overflow.".into(),
    })?;
    conn.execute(
        "UPDATE projects SET next_history_id = ?1 WHERE id = ?2",
        params![next, project_id.as_str()],
    )?;
    Ok(id)
}

fn append_event(
    conn: &Connection,
    project_id: &ProjectId,
    card_id: i64,
    draft: EventDraft<'_>,
) -> Result<(), SkanError> {
    let event = HistoryEvent {
        id: take_history_id(conn, project_id)?,
        kind: draft.kind,
        actor: draft.actor,
        reason: draft.reason.map(str::to_owned),
        from_card_status: draft.from_card_status,
        to_card_status: draft.to_card_status,
        from_agent_status: draft.from_agent_status,
        to_agent_status: draft.to_agent_status,
        request_id: draft.request_id.map(str::to_owned),
        at: draft.at,
    };
    insert_event(conn, project_id, card_id, &event)
}

/// The next free position at the end of a lane of one project.
fn lane_end(conn: &Connection, project_id: &ProjectId, lane: Column) -> Result<i64, SkanError> {
    let last: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0) FROM cards WHERE project_id = ?1 AND column_name = ?2",
        params![project_id.as_str(), lane.as_str()],
        |r| r.get(0),
    )?;
    last.checked_add(1).ok_or_else(|| SkanError::DatabaseError {
        reason: "Lane position overflow.".into(),
    })
}

impl ProjectStore {
    pub fn add_work_card(
        &self,
        project_id: &ProjectId,
        new: NewCard,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        let title = validate_title(&new.title)?;
        let description = normalize_and_validate_description(&new.description)?;
        self.write(|conn| {
            let id = load_counters(conn, project_id)?.next_card_id;
            let next_id = id.checked_add(1).ok_or_else(|| SkanError::DatabaseError {
                reason: "Card ID overflow.".into(),
            })?;
            let position = lane_end(conn, project_id, Column::Todo)?;
            conn.execute(
                "INSERT INTO cards (project_id, id, title, description, assignee, column_name,
                                    position, run_state, created_at, updated_at,
                                    run_state_changed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'todo', ?6, 'idle', ?7, ?7, ?7)",
                params![
                    project_id.as_str(),
                    id,
                    title,
                    description,
                    assignee_str(new.assignee),
                    position,
                    format_utc(now)
                ],
            )?;
            conn.execute(
                "UPDATE projects SET next_card_id = ?1 WHERE id = ?2",
                params![next_id, project_id.as_str()],
            )?;
            append_event(
                conn,
                project_id,
                id,
                EventDraft {
                    kind: HistoryKind::Created,
                    actor: new.actor,
                    reason: None,
                    from_card_status: None,
                    to_card_status: Column::Todo,
                    from_agent_status: None,
                    to_agent_status: RunState::Idle,
                    request_id: None,
                    at: now,
                },
            )?;
            bump_project(conn, project_id)?;
            load_card(conn, project_id, id)
        })
    }

    /// Move a card to the end of a lane. A draft is read-only here, whoever
    /// the actor is: the move fails with `card_is_draft`.
    pub fn move_work_card(
        &self,
        project_id: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        self.move_card(project_id, id, to, ctx, now, true)
    }

    /// The same move for a user working in the Web UI: drafts can be moved.
    pub fn move_work_card_for_user(
        &self,
        project_id: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        self.move_card(project_id, id, to, ctx, now, false)
    }

    fn move_card(
        &self,
        project_id: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<Changed<Card>, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_project(conn, project_id)?;
            let old = load_card(conn, project_id, id)?;
            if block_drafts && old.is_draft {
                return Err(SkanError::CardIsDraft { id });
            }
            if old.card_status == to {
                return Ok(Changed {
                    value: old,
                    changed: false,
                });
            }
            let position = lane_end(conn, project_id, to)?;
            conn.execute(
                "UPDATE cards SET column_name = ?1, position = ?2, run_state = 'idle',
                        pending_reason = NULL, pending_request_id = NULL, updated_at = ?3,
                        run_state_changed_at =
                            CASE WHEN run_state != 'idle' THEN ?3 ELSE run_state_changed_at END
                 WHERE project_id = ?4 AND id = ?5",
                params![
                    to.as_str(),
                    position,
                    format_utc(now),
                    project_id.as_str(),
                    id
                ],
            )?;
            append_event(
                conn,
                project_id,
                id,
                EventDraft {
                    kind: HistoryKind::Lane,
                    actor: ctx.actor,
                    reason: Some(&reason),
                    from_card_status: Some(old.card_status),
                    to_card_status: to,
                    from_agent_status: Some(old.agent_status),
                    to_agent_status: RunState::Idle,
                    request_id: old.pending_request_id.as_deref(),
                    at: now,
                },
            )?;
            bump_project(conn, project_id)?;
            Ok(Changed {
                value: load_card(conn, project_id, id)?,
                changed: true,
            })
        })
    }

    pub fn set_agent_status(
        &self,
        project_id: &ProjectId,
        id: i64,
        state: RunState,
        ctx: ChangeContext,
        expected_request: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_project(conn, project_id)?;
            let old = load_card(conn, project_id, id)?;
            if old.is_draft {
                return Err(SkanError::CardIsDraft { id });
            }
            check_work_state(old.assignee, old.card_status, state)?;
            if old.agent_status == state {
                return Ok(Changed {
                    value: old,
                    changed: false,
                });
            }
            if old.agent_status == RunState::Pending
                && expected_request != old.pending_request_id.as_deref()
            {
                return Err(SkanError::RequestChanged);
            }
            let request_id = if state == RunState::Pending {
                Some(next_request_id()?)
            } else {
                None
            };
            let pending_reason = if state == RunState::Pending {
                Some(reason.as_str())
            } else {
                None
            };
            conn.execute(
                "UPDATE cards SET run_state = ?1, pending_reason = ?2, pending_request_id = ?3,
                        updated_at = ?4, run_state_changed_at = ?4
                 WHERE project_id = ?5 AND id = ?6",
                params![
                    state.as_str(),
                    pending_reason,
                    request_id,
                    format_utc(now),
                    project_id.as_str(),
                    id
                ],
            )?;
            append_event(
                conn,
                project_id,
                id,
                EventDraft {
                    kind: HistoryKind::Agent,
                    actor: ctx.actor,
                    reason: Some(&reason),
                    from_card_status: Some(old.card_status),
                    to_card_status: old.card_status,
                    from_agent_status: Some(old.agent_status),
                    to_agent_status: state,
                    request_id: request_id.as_deref(),
                    at: now,
                },
            )?;
            bump_project(conn, project_id)?;
            Ok(Changed {
                value: load_card(conn, project_id, id)?,
                changed: true,
            })
        })
    }

    pub fn answer_request(
        &self,
        project_id: &ProjectId,
        id: i64,
        request_id: &str,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_project(conn, project_id)?;
            let old = load_card(conn, project_id, id)?;
            if old.assignee != Assignee::Ai
                || old.card_status != Column::Doing
                || old.agent_status != RunState::Pending
                || old.pending_request_id.as_deref() != Some(request_id)
            {
                return Err(SkanError::RequestChanged);
            }
            conn.execute(
                "UPDATE cards SET run_state = 'idle', pending_reason = NULL,
                        pending_request_id = NULL, updated_at = ?1, run_state_changed_at = ?1
                 WHERE project_id = ?2 AND id = ?3",
                params![format_utc(now), project_id.as_str(), id],
            )?;
            append_event(
                conn,
                project_id,
                id,
                EventDraft {
                    kind: HistoryKind::Agent,
                    actor: ctx.actor,
                    reason: Some(&reason),
                    from_card_status: Some(old.card_status),
                    to_card_status: old.card_status,
                    from_agent_status: Some(RunState::Pending),
                    to_agent_status: RunState::Idle,
                    request_id: Some(request_id),
                    at: now,
                },
            )?;
            bump_project(conn, project_id)?;
            load_card(conn, project_id, id)
        })
    }

    pub fn card(&self, project_id: &ProjectId, id: i64) -> Result<Card, SkanError> {
        self.read(|conn| {
            require_project(conn, project_id)?;
            load_card(conn, project_id, id)
        })
    }

    /// The project, its board metadata, revision, cursor and every card with
    /// its full history, from one read transaction.
    pub fn snapshot(&self, project_id: &ProjectId) -> Result<BoardSnapshot, SkanError> {
        self.read(|conn| {
            let project = load_project(conn, project_id)?;
            board_snapshot(conn, project)
        })
    }

    /// Every project's snapshot, ordered by project name, and the catalog
    /// revision, all from one read transaction: no concurrent change shows in
    /// only some of the projects. Each element equals what
    /// [`ProjectStore::snapshot`] returns for that project. Writes and notifies
    /// nothing.
    pub fn all_snapshots(&self) -> Result<AllBoardsSnapshot, SkanError> {
        self.read(|conn| {
            let catalog = load_catalog(conn)?;
            let projects = catalog
                .projects
                .into_iter()
                .map(|project| board_snapshot(conn, project))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AllBoardsSnapshot {
                catalog_revision: catalog.catalog_revision,
                projects,
            })
        })
    }
}

/// The board of an already loaded project, read on the caller's transaction.
fn board_snapshot(conn: &Connection, project: ProjectMeta) -> Result<BoardSnapshot, SkanError> {
    let counters = load_counters(conn, &project.id)?;
    let cards = load_cards(conn, &project.id)?;
    let cursor = ChangeCursor::new(project.id.clone(), counters.revision)?;
    Ok(BoardSnapshot {
        board: BoardMeta {
            name: project.name.clone(),
            next_card_id: counters.next_card_id,
            created_at: project.created_at,
        },
        project,
        revision: counters.revision,
        cursor,
        cards,
    })
}
