//! Agent Board work-card operations. Every mutation records its audit event and
//! advances the board revision in the same immediate transaction.
use std::str::FromStr;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};

use super::{Store, rows::require_board};
use crate::{
    clock::{format_utc, parse_utc},
    domain::*,
    error::SkanError,
};

fn next_request_id() -> Result<String, SkanError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn assignee_str(value: Assignee) -> &'static str {
    match value {
        Assignee::Ai => "ai",
        Assignee::Human => "human",
    }
}

pub(super) fn bump(conn: &Connection) -> Result<(), SkanError> {
    let n = conn.execute(
        "UPDATE board SET revision=revision+1 WHERE id=1 AND revision < 9223372036854775807",
        [],
    )?;
    if n != 1 {
        return Err(SkanError::DatabaseError {
            reason: "Board revision overflow.".into(),
        });
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn event(
    conn: &Connection,
    card: &Card,
    kind: HistoryKind,
    actor: Actor,
    reason: Option<&str>,
    fc: Option<Column>,
    tc: Column,
    fs: Option<RunState>,
    ts: RunState,
    request: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), SkanError> {
    conn.execute("INSERT INTO history(card_id,kind,actor,reason,from_column,to_column,from_agent_status,to_agent_status,request_id,at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![card.id,
        match kind { HistoryKind::Created=>"created", HistoryKind::Lane=>"lane", HistoryKind::Agent=>"agent" },
        match actor {Actor::Ai=>"ai",Actor::Human=>"human"}, reason, fc.map(|v|v.as_str()),tc.as_str(),fs.map(|v|v.as_str()),ts.as_str(),request,format_utc(at)])?;
    Ok(())
}

fn history(conn: &Connection, id: i64) -> Result<Vec<HistoryEvent>, SkanError> {
    let mut stmt=conn.prepare("SELECT id,kind,actor,reason,from_column,to_column,from_agent_status,to_agent_status,request_id,at FROM history WHERE card_id=?1 ORDER BY id")?;
    let rows = stmt
        .query_map([id], |r| {
            let k: String = r.get(1)?;
            let a: String = r.get(2)?;
            let fc: Option<String> = r.get(4)?;
            let tc: String = r.get(5)?;
            let fs: Option<String> = r.get(6)?;
            let ts: String = r.get(7)?;
            let at: String = r.get(9)?;
            let kind = match k.as_str() {
                "created" => HistoryKind::Created,
                "lane" => HistoryKind::Lane,
                "agent" => HistoryKind::Agent,
                _ => {
                    return Err(conversion(
                        1,
                        std::io::Error::other(format!("invalid history kind: {k}")),
                    ));
                }
            };
            let actor = match a.as_str() {
                "ai" => Actor::Ai,
                "human" => Actor::Human,
                _ => {
                    return Err(conversion(
                        2,
                        std::io::Error::other(format!("invalid actor: {a}")),
                    ));
                }
            };
            Ok(HistoryEvent {
                id: r.get(0)?,
                kind,
                actor,
                reason: r.get(3)?,
                from_card_status: fc.map(|s| parse_column(4, &s)).transpose()?,
                to_card_status: parse_column(5, &tc)?,
                from_agent_status: fs.map(|s| parse_state(6, &s)).transpose()?,
                to_agent_status: parse_state(7, &ts)?,
                request_id: r.get(8)?,
                at: parse_utc(&at).map_err(|e| conversion(9, e))?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
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

pub(super) fn load_card(conn: &Connection, id: i64) -> Result<Card, SkanError> {
    let mut stmt=conn.prepare("SELECT id,title,description,assignee,column_name,position,run_state,pending_reason,pending_request_id,created_at,updated_at,run_state_changed_at FROM cards WHERE id=?1")?;
    let base = stmt
        .query_row([id], |r| {
            let assignee: String = r.get(3)?;
            let col: String = r.get(4)?;
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
                let s: String = r.get(i)?;
                parse_utc(&s).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        i,
                        rusqlite::types::Type::Text,
                        e.into(),
                    )
                })
            };
            Ok(Card {
                id: r.get(0)?,
                title: r.get(1)?,
                description: r.get(2)?,
                assignee,
                card_status: parse_column(4, &col)?,
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
    let mut card = base;
    card.history = history(conn, id)?;
    Ok(card)
}

impl Store {
    pub fn add_work_card(&self, new: NewCard, now: DateTime<Utc>) -> Result<Card, SkanError> {
        let title = validate_title(&new.title)?;
        let description = normalize_and_validate_description(&new.description)?;
        self.write(|conn| {
            require_board(conn)?;
            let id: i64 = conn.query_row("SELECT next_card_id FROM board WHERE id=1", [], |r| r.get(0))?;
            let next_id = id.checked_add(1).ok_or_else(|| SkanError::DatabaseError { reason: "Card ID overflow.".into() })?;
            let position: i64 = conn.query_row("SELECT COALESCE(MAX(position),0)+1 FROM cards WHERE column_name='todo'", [], |r| r.get(0))?;
            conn.execute(
                "INSERT INTO cards(id,title,description,column_name,position,run_state,assignee,created_at,updated_at,run_state_changed_at) VALUES(?1,?2,?3,'todo',?4,'idle',?5,?6,?6,?6)",
                params![id, title, description, position, assignee_str(new.assignee), format_utc(now)],
            )?;
            conn.execute("UPDATE board SET next_card_id=?1 WHERE id=1", [next_id])?;
            let card = load_card(conn, id)?;
            event(conn, &card, HistoryKind::Created, new.actor, None, None, Column::Todo, None, RunState::Idle, None, now)?;
            bump(conn)?;
            load_card(conn, id)
        })
    }
    pub fn move_work_card(
        &self,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_board(conn)?;
            let old = load_card(conn, id)?;
            if old.card_status == to {
                return Ok(Changed { value: old, changed: false });
            }
            let position: i64 = conn.query_row(
                "SELECT COALESCE(MAX(position),0)+1 FROM cards WHERE column_name=?1",
                [to.as_str()],
                |r| r.get(0),
            )?;
            conn.execute(
                "UPDATE cards SET column_name=?1,position=?2,run_state='idle',pending_reason=NULL,pending_request_id=NULL,updated_at=?3,run_state_changed_at=CASE WHEN run_state!='idle' THEN ?3 ELSE run_state_changed_at END WHERE id=?4",
                params![to.as_str(), position, format_utc(now), id],
            )?;
            event(conn, &old, HistoryKind::Lane, ctx.actor, Some(&reason), Some(old.card_status), to, Some(old.agent_status), RunState::Idle, old.pending_request_id.as_deref(), now)?;
            bump(conn)?;
            Ok(Changed { value: load_card(conn, id)?, changed: true })
        })
    }
    pub fn set_agent_status(
        &self,
        id: i64,
        state: RunState,
        ctx: ChangeContext,
        expected_request: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<Card>, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_board(conn)?;
            let old = load_card(conn, id)?;
            check_work_state(old.assignee, old.card_status, state)?;
            if old.agent_status == state {
                return Ok(Changed { value: old, changed: false });
            }
            if old.agent_status == RunState::Pending && expected_request != old.pending_request_id.as_deref() {
                return Err(SkanError::RequestChanged);
            }
            let request_id = if state == RunState::Pending { Some(next_request_id()?) } else { None };
            let pending_reason = if state == RunState::Pending { Some(reason.as_str()) } else { None };
            conn.execute(
                "UPDATE cards SET run_state=?1,pending_reason=?2,pending_request_id=?3,updated_at=?4,run_state_changed_at=?4 WHERE id=?5",
                params![state.as_str(), pending_reason, request_id, format_utc(now), id],
            )?;
            event(conn, &old, HistoryKind::Agent, ctx.actor, Some(&reason), Some(old.card_status), old.card_status, Some(old.agent_status), state, request_id.as_deref(), now)?;
            bump(conn)?;
            Ok(Changed { value: load_card(conn, id)?, changed: true })
        })
    }
    pub fn answer_request(
        &self,
        id: i64,
        request_id: &str,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        self.write(|conn| {
            require_board(conn)?;
            let old = load_card(conn, id)?;
            if old.assignee != Assignee::Ai || old.card_status != Column::Doing || old.agent_status != RunState::Pending || old.pending_request_id.as_deref() != Some(request_id) {
                return Err(SkanError::RequestChanged);
            }
            conn.execute(
                "UPDATE cards SET run_state='idle',pending_reason=NULL,pending_request_id=NULL,updated_at=?1,run_state_changed_at=?1 WHERE id=?2",
                params![format_utc(now), id],
            )?;
            event(conn, &old, HistoryKind::Agent, ctx.actor, Some(&reason), Some(old.card_status), old.card_status, Some(RunState::Pending), RunState::Idle, Some(request_id), now)?;
            bump(conn)?;
            load_card(conn, id)
        })
    }
    pub fn card(&self, id: i64) -> Result<Card, SkanError> {
        self.read(|c| {
            require_board(c)?;
            load_card(c, id)
        })
    }
    pub fn snapshot(&self) -> Result<BoardSnapshot, SkanError> {
        self.read(|c| {
            let board = require_board(c)?;
            let revision =
                c.query_row("SELECT revision FROM board WHERE id=1", [], |r| r.get(0))?;
            let ids = {
                let mut s = c.prepare("SELECT id FROM cards ORDER BY id")?;
                let rows = s.query_map([], |r| r.get::<_, i64>(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            };
            let cards = ids
                .into_iter()
                .map(|id| load_card(c, id))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(BoardSnapshot {
                board,
                revision,
                cards,
            })
        })
    }

    /// Replace the complete Agent Board snapshot in one transaction. The
    /// caller-provided revision is informational and is never imported.
    pub fn replace_all(&self, snapshot: &BoardSnapshot) -> Result<(), SkanError> {
        self.write(|c| {
            let current: Option<i64> = c.query_row(
                "SELECT revision FROM board WHERE id=1",
                [],
                |r| r.get(0),
            ).optional()?;
            let revision = current.unwrap_or(0).checked_add(1).ok_or_else(|| SkanError::DatabaseError { reason: "Board revision overflow.".into() })?;
            super::rows::delete_everything(c)?;
            super::rows::insert_board(c, &snapshot.board)?;
            c.execute("UPDATE board SET revision=?1 WHERE id=1", [revision])?;
            for card in &snapshot.cards {
                c.execute(
                    "INSERT INTO cards(id,title,description,column_name,position,run_state,assignee,pending_reason,pending_request_id,created_at,updated_at,run_state_changed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![card.id, card.title, card.description, card.card_status.as_str(), card.position, card.agent_status.as_str(), assignee_str(card.assignee), card.pending_reason, card.pending_request_id, format_utc(card.created_at), format_utc(card.updated_at), format_utc(card.agent_status_changed_at)],
                )?;
                for item in &card.history {
                    c.execute(
                        "INSERT INTO history(id,card_id,kind,actor,reason,from_column,to_column,from_agent_status,to_agent_status,request_id,at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                        params![item.id, card.id,
                            match item.kind { HistoryKind::Created=>"created", HistoryKind::Lane=>"lane", HistoryKind::Agent=>"agent" },
                            match item.actor { Actor::Ai=>"ai", Actor::Human=>"human" }, item.reason,
                            item.from_card_status.map(|v|v.as_str()), item.to_card_status.as_str(),
                            item.from_agent_status.map(|v|v.as_str()), item.to_agent_status.as_str(), item.request_id,
                            format_utc(item.at)],
                    )?;
                }
            }
            Ok(())
        })
    }
}
