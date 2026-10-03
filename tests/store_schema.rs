use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use skan::error::SkanError;
use skan::store::Store;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, 0, 0).unwrap()
}

fn user_version(path: &std::path::Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_new_database_gets_schema_version_1() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    Store::open(&path).unwrap();
    assert_eq!(user_version(&path), 1);

    let conn = Connection::open(&path).unwrap();
    let mut tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    tables.sort();
    assert_eq!(tables, vec!["board", "cards", "transitions"]);
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(journal, "wal");
}

#[test]
fn open_creates_missing_directories() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a").join("b").join("board.db");
    Store::open(&path).unwrap();
    assert!(path.exists());
}

#[test]
fn reopening_a_version_1_database_keeps_its_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    Store::open(&path)
        .unwrap()
        .create_board("main", now())
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert_eq!(store.board().unwrap().unwrap().name, "main");
    assert_eq!(user_version(&path), 1);
}

#[test]
fn schema_enforces_the_model_constraints() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = Store::open(&path).unwrap();
    store.create_board("main", now()).unwrap();
    store.add_card("a", "", now()).unwrap();
    let conn = Connection::open(&path).unwrap();
    // running outside doing violates the CHECK constraint
    assert!(
        conn.execute("UPDATE cards SET run_state = 'running' WHERE id = 1", [])
            .is_err()
    );
    // a reason without pending violates the CHECK constraint
    assert!(
        conn.execute("UPDATE cards SET pending_reason = 'x' WHERE id = 1", [])
            .is_err()
    );
    // a second board row is impossible
    assert!(
        conn.execute(
            "INSERT INTO board VALUES (2, 'x', 1, '2026-10-02T01:00:00Z')",
            []
        )
        .is_err()
    );
}

fn make_database_with_version(path: &std::path::Path, version: i64) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch("CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('keep');")
        .unwrap();
    conn.pragma_update(None, "user_version", version).unwrap();
}

#[test]
fn a_newer_schema_version_is_refused_and_left_untouched() {
    for version in [2, 3, 99] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("board.db");
        make_database_with_version(&path, version);
        let before = std::fs::read(&path).unwrap();

        let err = Store::open(&path).err().expect("open must fail");
        assert_eq!(
            err,
            SkanError::DatabaseError {
                reason: "The board was created by a newer version of skan.".into()
            }
        );
        assert_eq!(err.code(), "database_error");
        assert_eq!(std::fs::read(&path).unwrap(), before, "version {version}");
        assert_eq!(user_version(&path), version);
        // no WAL side files were created either
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["board.db"], "version {version}");
    }
}

#[test]
fn a_file_that_is_not_a_database_is_a_database_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    std::fs::write(
        &path,
        b"this is definitely not an sqlite database, just some text. ".repeat(20),
    )
    .unwrap();
    let before = std::fs::read(&path).unwrap();
    let err = Store::open(&path).err().expect("open must fail");
    assert!(matches!(err, SkanError::DatabaseError { .. }), "{err:?}");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
