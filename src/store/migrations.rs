//! Explicit, transactional storage migrations.
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags, backup::Backup};
use serde::Serialize;

use super::schema;
use crate::error::SkanError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub changed: bool,
    pub from: i64,
    pub to: i64,
    pub backup_path: Option<PathBuf>,
}

pub fn migrate(path: &Path) -> Result<MigrationReport, SkanError> {
    if !path.exists() {
        return Err(SkanError::NotInitialized);
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let from = schema::user_version(&conn)?;
    if from == schema::SCHEMA_VERSION {
        if !schema::has_expected_schema(&conn)? {
            return Err(SkanError::DatabaseError {
                reason: "The board schema is incomplete or contains unexpected tables.".into(),
            });
        }
        return Ok(MigrationReport {
            changed: false,
            from,
            to: from,
            backup_path: None,
        });
    }
    if from != 5 || !schema::has_expected_schema_legacy(&conn)? {
        return Err(SkanError::DatabaseError {
            reason: format!("Unsupported migration source version {from}."),
        });
    }
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let backup_result = make_backup(path, &conn);
    if backup_result.is_err() {
        let _ = conn.execute_batch("ROLLBACK");
    }
    let backup_path = backup_result?;
    conn.execute_batch("COMMIT")?;
    conn.pragma_update(None, "foreign_keys", false)?;
    let result = migrate_v5_to_v2(&conn);
    let _ = conn.pragma_update(None, "foreign_keys", true);
    result?;
    Ok(MigrationReport {
        changed: true,
        from,
        to: schema::SCHEMA_VERSION,
        backup_path: Some(backup_path),
    })
}

fn make_backup(path: &Path, _source: &Connection) -> Result<PathBuf, SkanError> {
    let dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| SkanError::DatabaseError {
        reason: e.to_string(),
    })?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let target_path = dir.join(format!("board-{stamp}.db"));
    let source_ro = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let mut target = Connection::open(&target_path)?;
    {
        let backup = Backup::new(&source_ro, &mut target)?;
        backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
    }
    let check: String = target.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(SkanError::DatabaseError {
            reason: "Backup integrity check failed.".into(),
        });
    }
    target.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    Ok(target_path)
}

fn migrate_v5_to_v2(conn: &Connection) -> Result<(), SkanError> {
    super::run_in_transaction(conn, "BEGIN IMMEDIATE", |conn| {
        for table in [
            "projects",
            "catalog_metadata",
            "cards",
            "history",
            "attachments",
            "attachment_requests",
        ] {
            conn.execute_batch(&format!("ALTER TABLE {table} RENAME TO {table}_legacy;"))?;
        }
        conn.execute_batch(schema::SCHEMA)?;
        conn.execute_batch("INSERT INTO projects SELECT * FROM projects_legacy;
            INSERT INTO catalog_metadata SELECT * FROM catalog_metadata_legacy;
            INSERT INTO cards (project_id,id,title,description,assignee,column_name,position,run_state,pending_reason,pending_request_id,created_at,updated_at,run_state_changed_at,is_draft,archived_at)
              SELECT project_id,id,title,description,assignee,column_name,position,run_state,pending_reason,pending_request_id,created_at,updated_at,run_state_changed_at,is_draft,NULL FROM cards_legacy;
            INSERT INTO history SELECT * FROM history_legacy;
            INSERT INTO attachments SELECT * FROM attachments_legacy;
            INSERT INTO attachment_requests SELECT * FROM attachment_requests_legacy;
            PRAGMA user_version = 2;
            DROP TABLE attachment_requests_legacy; DROP TABLE attachments_legacy; DROP TABLE history_legacy; DROP TABLE cards_legacy; DROP TABLE catalog_metadata_legacy; DROP TABLE projects_legacy;")?;
        Ok(())
    })
}
