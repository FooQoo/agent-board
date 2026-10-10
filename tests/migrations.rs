use assert_cmd::Command;
use serde_json::Value;
use tempfile::tempdir;

fn run(home: &std::path::Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .assert()
}

#[test]
fn migrate_is_explicit_and_does_not_create_a_missing_board() {
    let home = tempdir().unwrap();
    let result = run(home.path(), &["migrate", "--json"])
        .failure()
        .code(4)
        .get_output()
        .stderr
        .clone();
    let error: Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(error["error"]["code"], "not_initialized");
    assert!(!home.path().join("board.db").exists());
}

#[test]
#[ignore = "the SQLite migration command is removed with the store (removed with the SQLite store)"]
fn migrate_has_no_project_target_and_current_v2_is_a_noop() {
    let home = tempdir().unwrap();
    run(home.path(), &["project", "create", "demo"]).success();

    let with_project = run(home.path(), &["--project", "demo", "migrate", "--json"])
        .failure()
        .code(2)
        .get_output()
        .stderr
        .clone();
    let error: Value = serde_json::from_slice(&with_project).unwrap();
    assert_eq!(error["error"]["code"], "invalid_argument");

    let result = run(home.path(), &["migrate", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    let report: Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(report["changed"], false);
    assert_eq!(report["from"], 2);
    assert_eq!(report["to"], 2);
    assert!(report["backupPath"].is_null());
}
