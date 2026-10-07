//! SQLite-backed storage for every project.
//!
//! One [`ProjectStore`] wraps one connection. Every write runs in a single
//! `BEGIN IMMEDIATE` transaction and every read in a single read transaction,
//! so a failed operation leaves nothing behind and a read sees one consistent
//! state.

mod ops;
mod projects;
mod rows;
mod schema;
mod work;

pub use projects::{ProjectCounters, ProjectStore};

use rusqlite::Connection;

use crate::error::SkanError;

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
