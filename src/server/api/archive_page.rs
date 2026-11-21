//! `GET …/archive`: one page of a project's archived tasks, newest first.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};

use crate::error::AgboardError;
use crate::file_store::reader::sort_archived_newest_first;
use crate::server::AppState;
use crate::server::response::{agboard_error_response, json_response};
use crate::server::store::{indexed_view, parse_project_id};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

/// The place after which the next page starts: the last row's archive time and id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageCursor {
    archived_at: DateTime<Utc>,
    id: i64,
}

impl PageCursor {
    pub(super) fn new(archived_at: DateTime<Utc>, id: i64) -> PageCursor {
        PageCursor { archived_at, id }
    }

    /// The opaque text a client sends back: URL-safe base64 of `<nanoseconds>:<id>`.
    pub(super) fn encode(&self) -> String {
        let nanos = self.archived_at.timestamp_nanos_opt().unwrap_or(i64::MAX);
        URL_SAFE_NO_PAD.encode(format!("{nanos}:{}", self.id))
    }

    pub(super) fn decode(text: &str) -> Option<PageCursor> {
        let bytes = URL_SAFE_NO_PAD.decode(text).ok()?;
        let plain = String::from_utf8(bytes).ok()?;
        let (nanos, id) = plain.split_once(':')?;
        Some(PageCursor {
            archived_at: DateTime::from_timestamp_nanos(nanos.parse().ok()?),
            id: id.parse().ok()?,
        })
    }

    /// Whether a row sorts after this cursor in the newest-first order.
    pub(super) fn precedes(&self, archived_at: DateTime<Utc>, id: i64) -> bool {
        (archived_at, id) < (self.archived_at, self.id)
    }
}

fn bad(field: &str, reason: &str) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.to_string(),
        reason: reason.to_string(),
    }
}

fn parse_limit(query: &HashMap<String, String>) -> Result<usize, AgboardError> {
    let Some(raw) = query.get("limit") else {
        return Ok(DEFAULT_LIMIT);
    };
    match raw.parse::<usize>() {
        Ok(n) if (1..=MAX_LIMIT).contains(&n) => Ok(n),
        _ => Err(bad(
            "limit",
            &format!("must be a number from 1 to {MAX_LIMIT}"),
        )),
    }
}

pub(super) async fn archive(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let limit = match parse_limit(&query) {
        Ok(limit) => limit,
        Err(error) => return agboard_error_response(&error),
    };
    let after = match query.get("cursor") {
        None => None,
        Some(text) => match PageCursor::decode(text) {
            Some(cursor) => Some(cursor),
            None => {
                return agboard_error_response(&bad("cursor", "is not a cursor from this list"));
            }
        },
    };
    let view = match indexed_view(&state, &project_id) {
        Ok(view) => view,
        Err(error) => return agboard_error_response(&error),
    };
    let mut tasks: Vec<_> = view
        .tasks
        .iter()
        .filter(|task| task.archived_at.is_some())
        .collect();
    sort_archived_newest_first(&mut tasks);
    let total = tasks.len();
    if let Some(after) = after {
        // Keyset: the rows after the cursor, wherever archiving or restoring has moved the others.
        tasks.retain(|task| {
            task.archived_at
                .is_some_and(|at| after.precedes(at, task.id))
        });
    }
    let more = tasks.len() > limit;
    tasks.truncate(limit);
    let next_cursor = match (more, tasks.last()) {
        (true, Some(last)) => last
            .archived_at
            .map(|at| PageCursor::new(at, last.id).encode()),
        _ => None,
    };
    let used: HashSet<_> = tasks
        .iter()
        .filter_map(|task| task.epic_id.as_deref())
        .collect();
    let epics: Vec<_> = view
        .epics
        .iter()
        .filter(|epic| used.contains(epic.id.as_str()))
        .collect();
    json_response(
        StatusCode::OK,
        &serde_json::json!({
            "project": view.project,
            "version": view.version,
            "tasks": tasks,
            "epics": epics,
            "total": total,
            "nextCursor": next_cursor,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(second: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 2, 1, 0, second).unwrap()
    }

    #[test]
    fn a_cursor_round_trips() {
        let cursor = PageCursor::new(at(7), 42);
        assert_eq!(PageCursor::decode(&cursor.encode()), Some(cursor));
    }

    #[test]
    fn a_cursor_that_is_not_ours_is_refused() {
        for text in [
            "",
            "!!!",
            "bm90LWEtY3Vyc29y",
            &URL_SAFE_NO_PAD.encode("1:x"),
        ] {
            assert_eq!(PageCursor::decode(text), None, "{text}");
        }
    }

    #[test]
    fn precedes_follows_newest_first_with_the_higher_id_first_on_a_tie() {
        let cursor = PageCursor::new(at(5), 10);
        assert!(cursor.precedes(at(4), 99));
        assert!(cursor.precedes(at(5), 9));
        assert!(!cursor.precedes(at(5), 10));
        assert!(!cursor.precedes(at(5), 11));
        assert!(!cursor.precedes(at(6), 1));
    }

    #[test]
    fn the_limit_defaults_and_is_bounded() {
        let q = |v: &str| HashMap::from([("limit".to_string(), v.to_string())]);
        assert_eq!(parse_limit(&HashMap::new()).unwrap(), DEFAULT_LIMIT);
        assert_eq!(parse_limit(&q("200")).unwrap(), 200);
        for bad in ["0", "201", "-1", "x"] {
            assert!(parse_limit(&q(bad)).is_err(), "{bad}");
        }
    }
}
