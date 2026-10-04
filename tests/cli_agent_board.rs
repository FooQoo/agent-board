use assert_cmd::Command;
use serde_json::Value;
use tempfile::tempdir;

fn invoke(home: &std::path::Path, args: &[&str]) -> assert_cmd::assert::Assert {
    let mut command = Command::cargo_bin("agboard").unwrap();
    command
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .assert()
}

#[test]
fn agboard_requires_assignee_actor_and_reason_and_records_the_exchange() {
    let home = tempdir().unwrap();
    invoke(home.path(), &["init", "--name", "Agent Board"]).success();
    invoke(home.path(), &["add", "Work"]).failure();
    let created = invoke(
        home.path(),
        &["add", "Work", "--assignee", "ai", "--actor", "ai", "--json"],
    )
    .success()
    .get_output()
    .stdout
    .clone();
    let card: Value = serde_json::from_slice(&created).unwrap();
    assert_eq!(card["card"]["assignee"], "ai");
    let moved = invoke(
        home.path(),
        &[
            "mv", "1", "doing", "--actor", "ai", "--reason", "Begin", "--json",
        ],
    )
    .success()
    .get_output()
    .stdout
    .clone();
    let running = invoke(
        home.path(),
        &[
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--reason",
            "Need input",
            "--json",
        ],
    )
    .success()
    .get_output()
    .stdout
    .clone();
    let pending: Value = serde_json::from_slice(&running).unwrap();
    let request = pending["card"]["pendingRequestId"].as_str().unwrap();
    assert_eq!(pending["card"]["agentStatus"], "pending");
    let request_arg = format!("--request={request}");
    let answered = invoke(
        home.path(),
        &[
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--reason",
            "Proceed with A",
            &request_arg,
            "--json",
        ],
    )
    .success()
    .get_output()
    .stdout
    .clone();
    let answered: Value = serde_json::from_slice(&answered).unwrap();
    assert_eq!(answered["card"]["agentStatus"], "idle");
    assert_eq!(answered["card"]["history"].as_array().unwrap().len(), 4);
    let _ = moved;
}

#[test]
fn snapshot_is_read_only_and_returns_full_history() {
    let home = tempdir().unwrap();
    invoke(home.path(), &["snapshot", "--json"]).failure();
    assert!(!home.path().join("board.db").exists());
    invoke(home.path(), &["init", "--name", "Agent Board"]).success();
    let output = invoke(home.path(), &["snapshot", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    let snapshot: Value = serde_json::from_slice(&output).unwrap();
    assert!(snapshot["fetchedAt"].is_string());
    assert_eq!(snapshot["revision"], 0);
    assert_eq!(snapshot["cards"].as_array().unwrap().len(), 0);
}

#[test]
fn no_legacy_skan_binary_is_built() {
    let metadata = std::process::Command::new("cargo")
        .args(["metadata", "--no-deps", "--format-version", "1"])
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&metadata.stdout).unwrap();
    let bins: Vec<_> = value["packages"][0]["targets"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|target| {
            target["kind"]
                .as_array()
                .unwrap()
                .contains(&Value::String("bin".into()))
        })
        .map(|target| target["name"].as_str().unwrap())
        .collect();
    assert_eq!(bins, vec!["agboard"]);
}

#[test]
fn version_two_backup_round_trips_identically_into_a_fresh_data_directory() {
    let source = tempdir().unwrap();
    let restored = tempdir().unwrap();
    let files = tempdir().unwrap();
    let first = files.path().join("first.json");
    let second = files.path().join("second.json");
    invoke(source.path(), &["init", "--name", "Agent Board"]).success();
    invoke(
        source.path(),
        &["add", "Work", "--assignee", "ai", "--actor", "ai"],
    )
    .success();
    invoke(
        source.path(),
        &["mv", "1", "doing", "--actor", "ai", "--reason", "Start"],
    )
    .success();
    invoke(
        source.path(),
        &[
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--reason",
            "Need an answer",
        ],
    )
    .success();
    invoke(
        source.path(),
        &["export", "--output", first.to_str().unwrap()],
    )
    .success();
    let bytes = std::fs::read(&first).unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["format"], "skan-board");
    assert_eq!(value["version"], 2);
    invoke(restored.path(), &["import", first.to_str().unwrap()]).success();
    invoke(
        restored.path(),
        &["export", "--output", second.to_str().unwrap()],
    )
    .success();
    assert_eq!(std::fs::read(second).unwrap(), bytes);
}

#[test]
fn old_backup_versions_are_rejected_before_replacing_a_board() {
    let home = tempdir().unwrap();
    let files = tempdir().unwrap();
    let invalid = files.path().join("old.json");
    std::fs::write(&invalid, r#"{"format":"skan-board","version":1}"#).unwrap();
    invoke(home.path(), &["init", "--name", "Keep me"]).success();
    invoke(home.path(), &["import", invalid.to_str().unwrap()]).failure();
    let board = invoke(home.path(), &["snapshot", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    assert_eq!(
        serde_json::from_slice::<Value>(&board).unwrap()["board"]["name"],
        "Keep me"
    );
}
