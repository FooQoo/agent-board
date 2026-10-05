//! SQLite-backed board storage.
//!
//! One [`Store`] wraps one connection. Every write runs in a single
//! `BEGIN IMMEDIATE` transaction and every read in a single read transaction,
//! so a failed operation leaves nothing behind and a read sees one consistent
//! state.

mod ops;
mod projects;
mod rows;
mod schema;
mod schema_v3;
mod work;

pub use projects::{ProjectCounters, ProjectStore};

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::error::SkanError;

/// How long a write waits for another writer before giving up with
/// `DatabaseBusy`.
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (and if needed create and migrate) the database at `path`. Missing
    /// parent directories are created.
    pub fn open(path: &Path) -> Result<Store, SkanError> {
        Store::open_with_busy_timeout(path, BUSY_TIMEOUT)
    }

    /// Open an existing initialized database without creating or modifying it.
    pub fn open_read_only(path: &Path) -> Result<Store, SkanError> {
        if !path.exists() {
            return Err(SkanError::NotInitialized);
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        let version = schema::user_version(&conn)?;
        schema::check_version(version)?;
        if version != 2 {
            return Err(SkanError::NotInitialized);
        }
        conn.pragma_update(None, "query_only", true)?;
        Ok(Store { conn })
    }

    /// Like [`Store::open`] with a custom wait time for write contention.
    /// Exists so tests can provoke `DatabaseBusy` quickly.
    #[doc(hidden)]
    pub fn open_with_busy_timeout(path: &Path, timeout: Duration) -> Result<Store, SkanError> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| SkanError::DatabaseError {
                reason: e.to_string(),
            })?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(timeout)?;
        schema::prepare(&conn)?;
        Ok(Store { conn })
    }

    /// Run `f` inside `BEGIN IMMEDIATE ... COMMIT`; roll back if it fails.
    fn write<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, SkanError>,
    ) -> Result<T, SkanError> {
        run_in_transaction(&self.conn, "BEGIN IMMEDIATE", f)
    }

    /// Run `f` inside one read transaction (a consistent snapshot).
    fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T, SkanError>) -> Result<T, SkanError> {
        run_in_transaction(&self.conn, "BEGIN", f)
    }
}

pub(crate) fn run_in_transaction<T>(
    conn: &Connection,
    begin: &str,
    f: impl FnOnce(&Connection) -> Result<T, SkanError>,
) -> Result<T, SkanError> {
    conn.execute_batch(begin)?;
    match f(conn) {
        Ok(value) => match conn.execute_batch("COMMIT") {
            Ok(()) => Ok(value),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e.into())
            }
        },
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
