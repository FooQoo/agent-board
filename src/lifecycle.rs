//! Exclusive lifecycle coordination for serve and explicit migrations.
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::SkanError;

pub struct LifecycleGuard {
    conn: Option<Connection>,
    _path: PathBuf,
}

impl LifecycleGuard {
    pub fn acquire(data_dir: &Path) -> Result<Self, SkanError> {
        std::fs::create_dir_all(data_dir).map_err(|e| SkanError::DatabaseError {
            reason: e.to_string(),
        })?;
        let path = data_dir.join("lifecycle.lock.db");
        let conn = Connection::open(&path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS lifecycle_lock (id INTEGER PRIMARY KEY CHECK (id = 1)); INSERT OR IGNORE INTO lifecycle_lock(id) VALUES (1); BEGIN IMMEDIATE")
            .map_err(|e| match e { rusqlite::Error::SqliteFailure(_, _) => SkanError::DatabaseBusy, other => other.into() })?;
        Ok(Self {
            conn: Some(conn),
            _path: path,
        })
    }
}

impl Drop for LifecycleGuard {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            let _ = conn.execute_batch("ROLLBACK");
        }
    }
}
