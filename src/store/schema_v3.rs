//! Schema version 3: one database holding every project.
//!
//! Only a new, empty database is given this schema. A database with any other
//! version, or with tables but no version, is rejected and left untouched;
//! nothing here converts or deletes existing data.

use std::time::{Duration, Instant};

use rusqlite::Connection;

use crate::error::SkanError;

/// The only schema version this build reads or writes.
pub(super) const SCHEMA_VERSION: i64 = 3;

const SCHEMA: &str = "
CREATE TABLE projects (
  id               TEXT    PRIMARY KEY
                   CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
  name             TEXT    NOT NULL UNIQUE COLLATE BINARY CHECK (length(name) >= 1),
  created_at       TEXT    NOT NULL,
  next_card_id     INTEGER NOT NULL DEFAULT 1 CHECK (next_card_id >= 1),
  next_history_id  INTEGER NOT NULL DEFAULT 1 CHECK (next_history_id >= 1),
  revision         INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE catalog_metadata (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  revision  INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO catalog_metadata (id, revision) VALUES (1, 0);

CREATE TABLE cards (
  project_id            TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id                    INTEGER NOT NULL CHECK (id >= 1),
  title                 TEXT    NOT NULL,
  description           TEXT    NOT NULL DEFAULT '',
  assignee              TEXT    NOT NULL DEFAULT 'ai' CHECK (assignee IN ('ai', 'human')),
  column_name           TEXT    NOT NULL CHECK (column_name IN ('todo', 'doing', 'done')),
  position              INTEGER NOT NULL CHECK (position >= 1),
  run_state             TEXT    NOT NULL CHECK (run_state IN ('idle', 'running', 'pending')),
  pending_reason        TEXT,
  pending_request_id    TEXT,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL,
  run_state_changed_at  TEXT    NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, column_name, position),
  CHECK (run_state = 'idle' OR column_name = 'doing'),
  CHECK (assignee = 'ai' OR run_state = 'idle'),
  CHECK ((run_state = 'pending' AND pending_reason IS NOT NULL AND pending_request_id IS NOT NULL)
      OR (run_state != 'pending' AND pending_reason IS NULL AND pending_request_id IS NULL))
);

CREATE TABLE history (
  project_id          TEXT    NOT NULL,
  id                  INTEGER NOT NULL CHECK (id >= 1),
  card_id             INTEGER NOT NULL CHECK (card_id >= 1),
  kind                TEXT    NOT NULL CHECK (kind IN ('created', 'lane', 'agent')),
  actor               TEXT    NOT NULL CHECK (actor IN ('ai', 'human')),
  reason              TEXT,
  from_column         TEXT CHECK (from_column IN ('todo', 'doing', 'done')),
  to_column           TEXT    NOT NULL CHECK (to_column IN ('todo', 'doing', 'done')),
  from_agent_status   TEXT CHECK (from_agent_status IN ('idle', 'running', 'pending')),
  to_agent_status     TEXT    NOT NULL CHECK (to_agent_status IN ('idle', 'running', 'pending')),
  request_id          TEXT,
  at                  TEXT    NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, card_id) REFERENCES cards (project_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'created' AND from_column IS NULL AND from_agent_status IS NULL AND reason IS NULL AND to_agent_status = 'idle')
      OR (kind != 'created' AND from_column IS NOT NULL AND from_agent_status IS NOT NULL AND reason IS NOT NULL)),
  CHECK (kind != 'created' OR request_id IS NULL)
);
CREATE INDEX history_by_card ON history (project_id, card_id, id);
CREATE UNIQUE INDEX history_created_once ON history (project_id, card_id) WHERE kind = 'created';
";

pub(super) fn user_version(conn: &Connection) -> Result<i64, SkanError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

/// Accept version 0 (a candidate new database) and version 3. Everything else
/// is a `database_error`.
pub(super) fn check_version(version: i64) -> Result<(), SkanError> {
    match version {
        0 | SCHEMA_VERSION => Ok(()),
        v if v > SCHEMA_VERSION => Err(SkanError::DatabaseError {
            reason: "The board was created by a newer version of agboard.".to_string(),
        }),
        _ => Err(SkanError::DatabaseError {
            reason: format!(
                "The board uses schema version {version}. This version of agboard only uses version {SCHEMA_VERSION} and does not convert other versions."
            ),
        }),
    }
}

/// The schema version and the number of user tables, read together in one
/// read transaction. Creating the schema and setting the version happen in one
/// write transaction, so a reader sees either neither or both.
fn version_and_object_count(conn: &Connection) -> Result<(i64, i64), SkanError> {
    super::run_in_transaction(conn, "BEGIN", |conn| {
        let version = user_version(conn)?;
        let objects: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        Ok((version, objects))
    })
}

/// Switch the database to WAL. Changing the journal mode needs a lock that
/// SQLite does not always wait for, so another connection that is creating the
/// same new database at that moment makes this fail at once with a busy error.
/// Retry for as long as a write may wait.
fn enable_wal(conn: &Connection, timeout: Duration) -> Result<(), SkanError> {
    let deadline = Instant::now() + timeout;
    loop {
        match conn
            .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
        {
            Ok(_) => return Ok(()),
            Err(error) => match SkanError::from(error) {
                SkanError::DatabaseBusy if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                other => return Err(other),
            },
        }
    }
}

/// Check the schema version, set the per-connection pragmas and create the
/// schema in a new, empty database. `timeout` bounds how long a concurrent
/// first open of the same new database may be waited for.
///
/// The version is checked before anything else so that a database with another
/// schema is never modified (not even its journal mode).
pub(super) fn prepare(conn: &Connection, timeout: Duration) -> Result<(), SkanError> {
    let (version, objects) = version_and_object_count(conn)?;
    check_version(version)?;

    if version == 0 && objects != 0 {
        return Err(SkanError::DatabaseError {
            reason: "An unversioned non-empty database is not a fresh board.".into(),
        });
    }

    conn.pragma_update(None, "foreign_keys", true)?;
    enable_wal(conn, timeout)?;

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
