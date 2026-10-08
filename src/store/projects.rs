//! Project catalog storage (schema version 3).
//!
//! One [`ProjectStore`] owns one connection to the database that holds every
//! project. Every write runs in a single `BEGIN IMMEDIATE` transaction and
//! every read in a single read transaction. The catalog operations never guess
//! a project: a project is always named by its exact name or its [`ProjectId`].

use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

use super::{run_in_transaction, schema};
use crate::clock::{format_utc, parse_utc};
use crate::domain::{
    ChangeCursor, Changed, ProjectCatalog, ProjectId, ProjectMeta, validate_project_name,
};
use crate::error::SkanError;

/// How long a write waits for another writer before giving up with
/// `DatabaseBusy`.
const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

/// The per-project counters kept next to the project row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectCounters {
    /// The ID the next card in this project receives (starts at 1, never lowered).
    pub next_card_id: i64,
    /// The ID the next history event in this project receives (starts at 1, never lowered).
    pub next_history_id: i64,
    /// The project's change revision (starts at 0).
    pub revision: i64,
}

pub struct ProjectStore {
    conn: Connection,
}

impl ProjectStore {
    /// Open the database at `path`, creating the data area and a version 3
    /// schema with no projects when the database is new and empty. Any other
    /// existing schema is rejected with `database_error` and left unchanged.
    pub fn open(path: &Path) -> Result<ProjectStore, SkanError> {
        ProjectStore::open_with_busy_timeout(path, BUSY_TIMEOUT)
    }

    /// Open an existing version 3 database without creating or modifying
    /// anything. A missing file or an empty database is `not_initialized`; any
    /// other schema is `database_error`.
    pub fn open_read_only(path: &Path) -> Result<ProjectStore, SkanError> {
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
        if version != schema::SCHEMA_VERSION {
            return Err(SkanError::NotInitialized);
        }
        if !schema::has_expected_schema(&conn)? {
            return Err(SkanError::DatabaseError {
                reason: "The board schema is incomplete or contains unexpected tables.".into(),
            });
        }
        conn.pragma_update(None, "query_only", true)?;
        Ok(ProjectStore { conn })
    }

    /// Like [`ProjectStore::open`] with a custom wait time for write
    /// contention. Exists so tests can provoke `DatabaseBusy` quickly.
    #[doc(hidden)]
    pub fn open_with_busy_timeout(
        path: &Path,
        timeout: Duration,
    ) -> Result<ProjectStore, SkanError> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| SkanError::DatabaseError {
                reason: e.to_string(),
            })?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(timeout)?;
        schema::prepare(&conn, timeout)?;
        Ok(ProjectStore { conn })
    }

    /// Run `f` inside `BEGIN IMMEDIATE ... COMMIT`; roll back if it fails.
    pub(crate) fn write<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, SkanError>,
    ) -> Result<T, SkanError> {
        run_in_transaction(&self.conn, "BEGIN IMMEDIATE", f)
    }

    /// Run `f` inside one read transaction (a consistent snapshot).
    pub(crate) fn read<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, SkanError>,
    ) -> Result<T, SkanError> {
        run_in_transaction(&self.conn, "BEGIN", f)
    }

    /// Every project ordered by name, and the catalog revision, from one read.
    pub fn projects(&self) -> Result<ProjectCatalog, SkanError> {
        self.read(load_catalog)
    }

    /// Resolve a project by its exact (untrimmed, case-sensitive) name.
    pub fn project_by_name(&self, name: &str) -> Result<ProjectMeta, SkanError> {
        self.read(|conn| {
            conn.query_row(
                "SELECT id, name, created_at FROM projects WHERE name = ?1",
                [name],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .map(|(id, name, created_at)| project_meta(&id, name, &created_at))
            .transpose()?
            .ok_or_else(|| SkanError::ProjectNotFound {
                project: name.to_string(),
            })
        })
    }

    /// Resolve a project by its ID.
    pub fn project(&self, id: &ProjectId) -> Result<ProjectMeta, SkanError> {
        self.read(|conn| load_project(conn, id))
    }

    /// The project's card and history counters and revision.
    pub fn counters(&self, id: &ProjectId) -> Result<ProjectCounters, SkanError> {
        self.read(|conn| load_counters(conn, id))
    }

    /// The cursor for the project's current revision.
    pub fn cursor(&self, id: &ProjectId) -> Result<ChangeCursor, SkanError> {
        let counters = self.counters(id)?;
        ChangeCursor::new(id.clone(), counters.revision)
    }

    /// Create an empty project with a new ID, counters at 1 and revision 0, and
    /// advance the catalog revision. A name already in use is
    /// `ProjectNameExists`.
    pub fn create_project(&self, name: &str, now: DateTime<Utc>) -> Result<ProjectMeta, SkanError> {
        let name = validate_project_name(name)?;
        let id = ProjectId::generate()?;
        self.write(|conn| {
            conn.execute(
                "INSERT INTO projects (id, name, created_at, next_card_id, next_history_id, revision)
                 VALUES (?1, ?2, ?3, 1, 1, 0)",
                params![id.as_str(), name, format_utc(now)],
            )
            .map_err(|e| name_conflict(e, &name))?;
            bump_catalog(conn)?;
            Ok(ProjectMeta {
                id: id.clone(),
                name: name.clone(),
                // Stored with second precision; return what was stored.
                created_at: parse_utc(&format_utc(now)).unwrap_or(now),
            })
        })
    }

    /// Rename a project, keeping its ID. A name equal to the current one is a
    /// no-op that changes no revision. A real change advances the project
    /// revision and the catalog revision by one.
    pub fn rename_project(
        &self,
        id: &ProjectId,
        new_name: &str,
    ) -> Result<Changed<ProjectMeta>, SkanError> {
        let new_name = validate_project_name(new_name)?;
        self.write(|conn| {
            let current = load_project(conn, id)?;
            if current.name == new_name {
                return Ok(Changed {
                    value: current,
                    changed: false,
                });
            }
            conn.execute(
                "UPDATE projects SET name = ?1 WHERE id = ?2",
                params![new_name, id.as_str()],
            )
            .map_err(|e| name_conflict(e, &new_name))?;
            bump_project(conn, id)?;
            bump_catalog(conn)?;
            Ok(Changed {
                value: ProjectMeta {
                    name: new_name.clone(),
                    ..current
                },
                changed: true,
            })
        })
    }

    /// Delete a project with its cards and history and advance the catalog
    /// revision. Other projects are not touched. Confirming the deletion is the
    /// caller's job.
    pub fn delete_project(&self, id: &ProjectId) -> Result<(), SkanError> {
        self.write(|conn| {
            let deleted = conn.execute("DELETE FROM projects WHERE id = ?1", [id.as_str()])?;
            if deleted == 0 {
                return Err(not_found(id));
            }
            bump_catalog(conn)
        })
    }
}

fn not_found(id: &ProjectId) -> SkanError {
    SkanError::ProjectNotFound {
        project: id.to_string(),
    }
}

fn missing_catalog_row() -> SkanError {
    SkanError::DatabaseError {
        reason: "The catalog metadata row is missing.".into(),
    }
}

fn project_meta(id: &str, name: String, created_at: &str) -> Result<ProjectMeta, SkanError> {
    let corrupt = |what: &str| SkanError::DatabaseError {
        reason: format!("A stored project has an invalid {what}."),
    };
    Ok(ProjectMeta {
        id: id.parse().map_err(|_| corrupt("ID"))?,
        name,
        created_at: parse_utc(created_at).map_err(|_| corrupt("creation time"))?,
    })
}

/// Every project ordered by name (binary order) and the catalog revision,
/// read on the given connection so the caller controls the transaction.
pub(super) fn load_catalog(conn: &Connection) -> Result<ProjectCatalog, SkanError> {
    let mut statement =
        conn.prepare("SELECT id, name, created_at FROM projects ORDER BY name COLLATE BINARY ASC")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut projects = Vec::new();
    for row in rows {
        let (id, name, created_at) = row?;
        projects.push(project_meta(&id, name, &created_at)?);
    }
    let catalog_revision = conn
        .query_row(
            "SELECT revision FROM catalog_metadata WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => missing_catalog_row(),
            other => other.into(),
        })?;
    Ok(ProjectCatalog {
        projects,
        catalog_revision,
    })
}

pub(super) fn load_project(conn: &Connection, id: &ProjectId) -> Result<ProjectMeta, SkanError> {
    conn.query_row(
        "SELECT name, created_at FROM projects WHERE id = ?1",
        [id.as_str()],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()?
    .map(|(name, created_at)| project_meta(id.as_str(), name, &created_at))
    .transpose()?
    .ok_or_else(|| not_found(id))
}

pub(super) fn load_counters(
    conn: &Connection,
    id: &ProjectId,
) -> Result<ProjectCounters, SkanError> {
    conn.query_row(
        "SELECT next_card_id, next_history_id, revision FROM projects WHERE id = ?1",
        [id.as_str()],
        |row| {
            Ok(ProjectCounters {
                next_card_id: row.get(0)?,
                next_history_id: row.get(1)?,
                revision: row.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| not_found(id))
}

/// Fail with `project_not_found` unless the project exists.
pub(super) fn require_project(conn: &Connection, id: &ProjectId) -> Result<(), SkanError> {
    let found = conn
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1",
            [id.as_str()],
            |_| Ok(()),
        )
        .optional()?;
    found.ok_or_else(|| not_found(id))
}

/// Advance the catalog revision by one; fail the whole transaction at the
/// 64-bit limit.
pub(super) fn bump_catalog(conn: &Connection) -> Result<(), SkanError> {
    let changed = conn.execute(
        "UPDATE catalog_metadata SET revision = revision + 1
         WHERE id = 1 AND revision < 9223372036854775807",
        [],
    )?;
    if changed != 1 {
        return Err(SkanError::DatabaseError {
            reason: "Catalog revision overflow.".into(),
        });
    }
    Ok(())
}

/// Advance one project's revision by one; fail the whole transaction at the
/// 64-bit limit.
pub(super) fn bump_project(conn: &Connection, id: &ProjectId) -> Result<(), SkanError> {
    let changed = conn.execute(
        "UPDATE projects SET revision = revision + 1
         WHERE id = ?1 AND revision < 9223372036854775807",
        [id.as_str()],
    )?;
    if changed != 1 {
        return Err(SkanError::DatabaseError {
            reason: "Project revision overflow.".into(),
        });
    }
    Ok(())
}

/// Turn a violation of the unique project-name constraint into
/// `ProjectNameExists`. Every other SQLite error keeps its own meaning.
pub(super) fn name_conflict(error: rusqlite::Error, name: &str) -> SkanError {
    if let rusqlite::Error::SqliteFailure(failure, Some(message)) = &error
        && failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
        && message.contains("projects.name")
    {
        return SkanError::ProjectNameExists {
            name: name.to_string(),
        };
    }
    error.into()
}
