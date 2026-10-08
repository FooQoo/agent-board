use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_board::domain::{ChangeCursor, ProjectId};
use agent_board::error::SkanError;
use agent_board::store::ProjectStore;
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, 0, 0).unwrap()
}

fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("data").join("board.db")
}

fn raw(path: &Path) -> Connection {
    Connection::open(path).unwrap()
}

fn user_version(path: &Path) -> i64 {
    raw(path)
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap()
}

fn table_names(path: &Path) -> Vec<String> {
    let conn = raw(path);
    let mut names: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    names.sort();
    names
}

fn is_database_error(e: &SkanError) -> bool {
    matches!(e, SkanError::DatabaseError { .. })
}

// ---------- fresh database ----------

#[test]
fn a_new_database_gets_schema_version_5_with_an_empty_catalog() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();

    let catalog = store.projects().unwrap();
    assert!(catalog.projects.is_empty());
    assert_eq!(catalog.catalog_revision, 0);

    assert_eq!(user_version(&path), 5);
    assert_eq!(
        table_names(&path),
        vec![
            "attachment_requests",
            "attachments",
            "cards",
            "catalog_metadata",
            "history",
            "projects"
        ]
    );
    let conn = raw(&path);
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(journal, "wal");
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM catalog_metadata", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn reopening_a_version_5_database_keeps_its_content() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let created = {
        let store = ProjectStore::open(&path).unwrap();
        store.create_project("Alpha", now()).unwrap()
    };
    let store = ProjectStore::open(&path).unwrap();
    let catalog = store.projects().unwrap();
    assert_eq!(catalog.projects, vec![created]);
    assert_eq!(catalog.catalog_revision, 1);
}

// ---------- create / list ----------

#[test]
fn creating_projects_gives_distinct_ids_and_fresh_counters() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("A", now()).unwrap();
    let b = store.create_project("B", now()).unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(a.name, "A");
    assert_eq!(a.created_at, now());

    for p in [&a, &b] {
        let c = store.counters(&p.id).unwrap();
        assert_eq!(c.next_card_id, 1);
        assert_eq!(c.next_history_id, 1);
        assert_eq!(c.revision, 0);
        assert_eq!(
            store.cursor(&p.id).unwrap(),
            ChangeCursor::new(p.id.clone(), 0).unwrap()
        );
    }
    assert_eq!(store.projects().unwrap().catalog_revision, 2);
}

#[test]
fn create_trims_the_name_and_enforces_the_name_rule() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    assert_eq!(
        store.create_project("  Padded  ", now()).unwrap().name,
        "Padded"
    );
    for bad in ["", "   ", "two\nlines", &"x".repeat(51)] {
        let err = store.create_project(bad, now()).unwrap_err();
        assert!(matches!(err, SkanError::InvalidValue { .. }), "{bad:?}");
    }
    assert!(store.create_project(&"あ".repeat(50), now()).is_ok());
    // Only the two valid creations changed the catalog.
    assert_eq!(store.projects().unwrap().catalog_revision, 2);
}

#[test]
fn the_list_is_ordered_by_name_and_names_are_case_sensitive() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    for name in ["b", "B", "a", "A", "c"] {
        store.create_project(name, now()).unwrap();
    }
    let names: Vec<String> = store
        .projects()
        .unwrap()
        .projects
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, vec!["A", "B", "a", "b", "c"]);
}

#[test]
fn a_duplicate_name_is_rejected_without_any_change() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    store.create_project("A", now()).unwrap();
    let before = store.projects().unwrap();
    let err = store.create_project(" A ", now()).unwrap_err();
    assert!(matches!(err, SkanError::ProjectNameExists { .. }));
    assert_eq!(err.code(), "project_name_exists");
    assert_eq!(err.exit_code(), 2);
    assert_eq!(store.projects().unwrap(), before);
}

#[test]
fn lookup_by_name_and_id_uses_exact_match() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("Alpha", now()).unwrap();
    assert_eq!(store.project_by_name("Alpha").unwrap(), a);
    assert_eq!(store.project(&a.id).unwrap(), a);
    for miss in ["alpha", "Alph", "Alpha ", ""] {
        let err = store.project_by_name(miss).unwrap_err();
        assert!(matches!(err, SkanError::ProjectNotFound { .. }), "{miss:?}");
        assert_eq!(err.code(), "project_not_found");
        assert_eq!(err.exit_code(), 4);
    }
    let other = ProjectId::generate().unwrap();
    assert!(matches!(
        store.project(&other).unwrap_err(),
        SkanError::ProjectNotFound { .. }
    ));
}

// ---------- rename ----------

#[test]
fn rename_keeps_the_id_and_bumps_revision_and_catalog_once() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("A", now()).unwrap();
    let changed = store.rename_project(&a.id, "Renamed").unwrap();
    assert!(changed.changed);
    assert_eq!(changed.value.id, a.id);
    assert_eq!(changed.value.name, "Renamed");
    assert_eq!(changed.value.created_at, a.created_at);

    assert_eq!(store.counters(&a.id).unwrap().revision, 1);
    assert_eq!(store.projects().unwrap().catalog_revision, 2);
    assert_eq!(store.project(&a.id).unwrap().name, "Renamed");
    assert!(matches!(
        store.project_by_name("A").unwrap_err(),
        SkanError::ProjectNotFound { .. }
    ));
}

#[test]
fn rename_to_the_same_name_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("A", now()).unwrap();
    let r = store.rename_project(&a.id, "  A ").unwrap();
    assert!(!r.changed);
    assert_eq!(r.value, a);
    assert_eq!(store.counters(&a.id).unwrap().revision, 0);
    assert_eq!(store.projects().unwrap().catalog_revision, 1);
}

#[test]
fn rename_to_an_existing_name_or_invalid_name_or_unknown_id_fails_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("A", now()).unwrap();
    store.create_project("B", now()).unwrap();
    let before = store.projects().unwrap();

    let err = store.rename_project(&a.id, "B").unwrap_err();
    assert!(matches!(err, SkanError::ProjectNameExists { .. }));
    let err = store.rename_project(&a.id, "").unwrap_err();
    assert!(matches!(err, SkanError::InvalidValue { .. }));
    let ghost = ProjectId::generate().unwrap();
    let err = store.rename_project(&ghost, "Z").unwrap_err();
    assert!(matches!(err, SkanError::ProjectNotFound { .. }));

    assert_eq!(store.projects().unwrap(), before);
    assert_eq!(store.counters(&a.id).unwrap().revision, 0);
}

// ---------- delete ----------

#[test]
fn delete_removes_the_project_cards_and_history_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();
    let a = store.create_project("A", now()).unwrap();
    let b = store.create_project("B", now()).unwrap();
    // The same card and history numbers live in both projects.
    let conn = raw(&path);
    for p in [&a, &b] {
        conn.execute(
            "INSERT INTO cards(project_id,id,title,description,assignee,column_name,position,run_state,created_at,updated_at,run_state_changed_at)
             VALUES(?1,1,'t','','ai','todo',1,'idle','2026-10-02T01:00:00Z','2026-10-02T01:00:00Z','2026-10-02T01:00:00Z')",
            [p.id.as_str()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO history(project_id,id,card_id,kind,actor,reason,from_column,to_column,from_agent_status,to_agent_status,request_id,at)
             VALUES(?1,1,1,'created','ai',NULL,NULL,'todo',NULL,'idle',NULL,'2026-10-02T01:00:00Z')",
            [p.id.as_str()],
        )
        .unwrap();
    }
    drop(conn);

    store.delete_project(&a.id).unwrap();
    let conn = raw(&path);
    let count = |sql: &str, id: &str| -> i64 { conn.query_row(sql, [id], |r| r.get(0)).unwrap() };
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM cards WHERE project_id=?1",
            a.id.as_str()
        ),
        0
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM history WHERE project_id=?1",
            a.id.as_str()
        ),
        0
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM cards WHERE project_id=?1",
            b.id.as_str()
        ),
        1
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM history WHERE project_id=?1",
            b.id.as_str()
        ),
        1
    );

    let catalog = store.projects().unwrap();
    assert_eq!(catalog.projects, vec![b]);
    assert_eq!(catalog.catalog_revision, 3);
    assert!(matches!(
        store.delete_project(&a.id).unwrap_err(),
        SkanError::ProjectNotFound { .. }
    ));
    assert_eq!(store.projects().unwrap().catalog_revision, 3);
}

#[test]
fn recreating_a_deleted_name_gives_a_new_id() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let first = store.create_project("Same", now()).unwrap();
    store.delete_project(&first.id).unwrap();
    let second = store.create_project("Same", now()).unwrap();
    assert_ne!(first.id, second.id);
    assert!(matches!(
        store.project(&first.id).unwrap_err(),
        SkanError::ProjectNotFound { .. }
    ));
    assert_eq!(store.project_by_name("Same").unwrap().id, second.id);
    // The new project starts over at revision 0 under its own id.
    assert_eq!(store.counters(&second.id).unwrap().revision, 0);
}

#[test]
fn a_renamed_project_keeps_its_id_while_a_same_name_recreation_does_not() {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&db_path(&dir)).unwrap();
    let a = store.create_project("A", now()).unwrap();
    store.rename_project(&a.id, "A2").unwrap();
    let again = store.create_project("A", now()).unwrap();
    assert_ne!(again.id, a.id);
    assert_eq!(store.project(&a.id).unwrap().name, "A2");
}

// ---------- schema guards ----------

fn schema_snapshot(path: &Path) -> (Vec<u8>, i64) {
    (std::fs::read(path).unwrap(), user_version(path))
}

#[test]
fn an_empty_file_is_accepted_as_a_new_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    std::fs::write(&path, b"").unwrap();
    ProjectStore::open(&path).unwrap();
    assert_eq!(user_version(&path), 5);
}

#[test]
fn a_version_0_database_with_user_tables_is_rejected_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    raw(&path)
        .execute_batch("CREATE TABLE stray (x INTEGER); INSERT INTO stray VALUES (1);")
        .unwrap();
    let before = schema_snapshot(&path);
    let err = ProjectStore::open(&path).err().unwrap();
    assert!(is_database_error(&err), "{err:?}");
    assert_eq!(schema_snapshot(&path), before);
    assert_eq!(table_names(&path), vec!["stray"]);
}

#[test]
fn other_schema_versions_are_rejected_unchanged() {
    for version in [1, 2, 3, 5, 99] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("board.db");
        raw(&path)
            .execute_batch(&format!(
                "CREATE TABLE board (id INTEGER); INSERT INTO board VALUES (7); PRAGMA user_version = {version};"
            ))
            .unwrap();
        let before = schema_snapshot(&path);
        let err = ProjectStore::open(&path).err().unwrap();
        assert!(is_database_error(&err), "version {version}: {err:?}");
        let err = ProjectStore::open_read_only(&path).err().unwrap();
        assert!(
            is_database_error(&err),
            "read-only version {version}: {err:?}"
        );
        assert_eq!(schema_snapshot(&path), before, "version {version}");
        assert_eq!(table_names(&path), vec!["board"]);
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert!(
            !leftovers.iter().any(|n| n.ends_with("-wal")),
            "{leftovers:?}"
        );
    }
}

#[test]
fn a_corrupt_file_is_rejected_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    std::fs::write(
        &path,
        b"this is definitely not a sqlite database file at all",
    )
    .unwrap();
    let before = std::fs::read(&path).unwrap();
    let err = ProjectStore::open(&path).err().unwrap();
    assert!(is_database_error(&err), "{err:?}");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn read_only_never_creates_the_data_area() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    assert!(ProjectStore::open_read_only(&path).is_err());
    assert!(!path.exists());
    assert!(!path.parent().unwrap().exists());
}

#[test]
fn read_only_rejects_an_empty_unversioned_file_without_touching_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    std::fs::write(&path, b"").unwrap();
    assert!(ProjectStore::open_read_only(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap().len(), 0);
}

#[test]
fn read_only_reads_but_cannot_write_and_leaves_the_file_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let a = {
        let store = ProjectStore::open(&path).unwrap();
        store.create_project("A", now()).unwrap()
    };
    let before = std::fs::read(&path).unwrap();
    let ro = ProjectStore::open_read_only(&path).unwrap();
    assert_eq!(ro.projects().unwrap().projects, vec![a.clone()]);
    assert!(ro.create_project("B", now()).is_err());
    assert!(ro.rename_project(&a.id, "C").is_err());
    assert!(ro.delete_project(&a.id).is_err());
    assert_eq!(ro.projects().unwrap().catalog_revision, 1);
    drop(ro);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(user_version(&path), 5);
}

// ---------- atomicity and contention ----------

#[test]
fn concurrent_creation_of_the_same_name_succeeds_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    ProjectStore::open(&path).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let store = ProjectStore::open(&path).unwrap();
                barrier.wait();
                store.create_project("Race", now())
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let ok = results.iter().filter(|r| r.is_ok()).count();
    let exists = results
        .iter()
        .filter(|r| matches!(r, Err(SkanError::ProjectNameExists { .. })))
        .count();
    assert_eq!((ok, exists), (1, 1), "{results:?}");
    let catalog = ProjectStore::open(&path).unwrap().projects().unwrap();
    assert_eq!(catalog.projects.len(), 1);
    assert_eq!(catalog.catalog_revision, 1);
}

#[test]
fn concurrent_first_open_of_a_new_database_creates_one_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                ProjectStore::open(&path).map(|_| ())
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap().unwrap();
    }
    assert_eq!(user_version(&path), 5);
}

#[test]
fn a_busy_database_fails_with_database_busy_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let setup = ProjectStore::open(&path).unwrap();
    let a = setup.create_project("A", now()).unwrap();
    let store = ProjectStore::open_with_busy_timeout(&path, Duration::from_millis(50)).unwrap();

    let blocker = raw(&path);
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(
        store.create_project("B", now()).unwrap_err(),
        SkanError::DatabaseBusy
    );
    assert_eq!(
        store.rename_project(&a.id, "C").unwrap_err(),
        SkanError::DatabaseBusy
    );
    assert_eq!(
        store.delete_project(&a.id).unwrap_err(),
        SkanError::DatabaseBusy
    );
    blocker.execute_batch("ROLLBACK").unwrap();

    let catalog = store.projects().unwrap();
    assert_eq!(catalog.projects, vec![a]);
    assert_eq!(catalog.catalog_revision, 1);
}

#[test]
fn catalog_revision_overflow_rolls_back_create_rename_and_delete() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();
    let a = store.create_project("A", now()).unwrap();
    raw(&path)
        .execute(
            "UPDATE catalog_metadata SET revision = 9223372036854775807",
            [],
        )
        .unwrap();

    for err in [
        store.create_project("B", now()).unwrap_err(),
        store.rename_project(&a.id, "C").unwrap_err(),
        store.delete_project(&a.id).unwrap_err(),
    ] {
        assert!(is_database_error(&err), "{err:?}");
        assert_eq!(err.exit_code(), 1);
    }
    let catalog = store.projects().unwrap();
    assert_eq!(catalog.projects, vec![a.clone()]);
    assert_eq!(catalog.catalog_revision, i64::MAX);
    assert_eq!(store.counters(&a.id).unwrap().revision, 0);
}

#[test]
fn project_revision_overflow_rolls_back_a_rename() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();
    let a = store.create_project("A", now()).unwrap();
    raw(&path)
        .execute("UPDATE projects SET revision = 9223372036854775807", [])
        .unwrap();
    let err = store.rename_project(&a.id, "C").unwrap_err();
    assert!(is_database_error(&err), "{err:?}");
    assert_eq!(store.project(&a.id).unwrap().name, "A");
    assert_eq!(store.projects().unwrap().catalog_revision, 1);
    assert_eq!(store.counters(&a.id).unwrap().revision, i64::MAX);
}

#[test]
fn only_the_name_constraint_maps_to_name_exists() {
    // A failure inside the transaction that is not a duplicate name must stay a database error.
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();
    store.create_project("A", now()).unwrap();
    // Removing the catalog row makes the catalog update fail after the INSERT succeeded.
    raw(&path)
        .execute("DELETE FROM catalog_metadata", [])
        .unwrap();
    let err = store.create_project("B", now()).unwrap_err();
    assert!(is_database_error(&err), "{err:?}");
    assert!(store.project_by_name("B").is_err());
}

// ---------- schema constraints ----------

#[test]
fn the_schema_enforces_composite_keys_and_position_uniqueness() {
    let dir = tempfile::tempdir().unwrap();
    let path = db_path(&dir);
    let store = ProjectStore::open(&path).unwrap();
    let a = store.create_project("A", now()).unwrap();
    let conn = raw(&path);
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    let insert = |id: i64, pos: i64| {
        conn.execute(
            "INSERT INTO cards(project_id,id,title,description,assignee,column_name,position,run_state,created_at,updated_at,run_state_changed_at)
             VALUES(?1,?2,'t','','ai','todo',?3,'idle','x','x','x')",
            rusqlite::params![a.id.as_str(), id, pos],
        )
    };
    insert(1, 1).unwrap();
    assert!(insert(1, 2).is_err(), "duplicate (project_id, id)");
    assert!(
        insert(2, 1).is_err(),
        "duplicate (project_id, column, position)"
    );
    assert!(insert(0, 5).is_err(), "non-positive id");
    // A card for an unknown project is rejected by the foreign key.
    assert!(
        conn.execute(
            "INSERT INTO cards(project_id,id,title,description,assignee,column_name,position,run_state,created_at,updated_at,run_state_changed_at)
             VALUES('ffffffffffffffffffffffffffffffff',1,'t','','ai','todo',1,'idle','x','x','x')",
            [],
        )
        .is_err()
    );
    // History must point at a card of the same project.
    assert!(
        conn.execute(
            "INSERT INTO history(project_id,id,card_id,kind,actor,reason,from_column,to_column,from_agent_status,to_agent_status,request_id,at)
             VALUES(?1,1,99,'created','ai',NULL,NULL,'todo',NULL,'idle',NULL,'x')",
            [a.id.as_str()],
        )
        .is_err()
    );
}
