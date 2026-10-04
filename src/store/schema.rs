use rusqlite::Connection;

use crate::error::SkanError;

/// The schema version this build understands.
const SCHEMA_VERSION: i64 = 2;

const SCHEMA: &str = "
CREATE TABLE board (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT    NOT NULL,
  next_card_id  INTEGER NOT NULL CHECK (next_card_id >= 1),
  created_at    TEXT    NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE cards (
  id                    INTEGER PRIMARY KEY,
  title                 TEXT    NOT NULL,
  description           TEXT    NOT NULL DEFAULT '',
  column_name           TEXT    NOT NULL CHECK (column_name IN ('todo', 'doing', 'done')),
  position              INTEGER NOT NULL CHECK (position >= 1),
  run_state             TEXT    NOT NULL CHECK (run_state IN ('idle', 'running', 'pending')),
  assignee              TEXT    NOT NULL DEFAULT 'ai' CHECK (assignee IN ('ai', 'human')),
  pending_reason        TEXT,
  pending_request_id    TEXT,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL,
  run_state_changed_at  TEXT    NOT NULL,
  UNIQUE (column_name, position),
  CHECK (run_state = 'idle' OR column_name = 'doing'),
  CHECK (assignee = 'ai' OR run_state = 'idle'),
  CHECK ((run_state = 'pending' AND pending_reason IS NOT NULL AND pending_request_id IS NOT NULL)
      OR (run_state != 'pending' AND pending_reason IS NULL AND pending_request_id IS NULL))
);

CREATE TABLE history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id             INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('created', 'lane', 'agent')),
  actor               TEXT CHECK (actor IN ('ai', 'human')),
  reason              TEXT,
  from_column         TEXT CHECK (from_column IN ('todo', 'doing', 'done')),
  to_column           TEXT NOT NULL CHECK (to_column IN ('todo', 'doing', 'done')),
  from_agent_status   TEXT CHECK (from_agent_status IN ('idle', 'running', 'pending')),
  to_agent_status     TEXT NOT NULL CHECK (to_agent_status IN ('idle', 'running', 'pending')),
  request_id          TEXT,
  at                  TEXT NOT NULL,
  CHECK ((kind = 'created' AND from_column IS NULL AND from_agent_status IS NULL AND reason IS NULL AND to_agent_status='idle')
      OR (kind != 'created' AND from_column IS NOT NULL AND from_agent_status IS NOT NULL AND reason IS NOT NULL)),
  CHECK (actor IS NOT NULL),
  CHECK (kind != 'created' OR request_id IS NULL)
);
CREATE INDEX history_by_card ON history (card_id, id);
CREATE UNIQUE INDEX history_created_once ON history (card_id) WHERE kind = 'created';
";

pub(super) fn user_version(conn: &Connection) -> Result<i64, SkanError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

pub(super) fn check_version(version: i64) -> Result<(), SkanError> {
    match version {
        0 | SCHEMA_VERSION => Ok(()),
        v if v > SCHEMA_VERSION => Err(SkanError::DatabaseError {
            reason: "The board was created by a newer version of agboard.".to_string(),
        }),
        _ => Err(SkanError::DatabaseError {
            reason: "The board has an unknown schema version.".to_string(),
        }),
    }
}

/// Check the schema version, set the per-connection pragmas and create the
/// schema in a new database.
///
/// The version is checked before anything else so that a database from a
/// newer version is never modified (not even its journal mode).
pub(super) fn prepare(conn: &Connection) -> Result<(), SkanError> {
    let version = user_version(conn)?;
    check_version(version)?;

    if version == 0 {
        let object_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        if object_count != 0 {
            return Err(SkanError::DatabaseError {
                reason: "An unversioned non-empty database is not a fresh board.".into(),
            });
        }
    }

    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;

    if version == 0 {
        super::run_in_transaction(conn, "BEGIN IMMEDIATE", |conn| {
            // Another process may have created the schema while we waited.
            if user_version(conn)? == 0 {
                conn.execute_batch(SCHEMA)?;
                conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            }
            Ok(())
        })?;
    }
    Ok(())
}
