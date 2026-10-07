use assert_cmd::Command;
use serde_json::Value;
use tempfile::tempdir;

/// Run `agboard --project "Agent Board" <args>`.
fn invoke(home: &std::path::Path, args: &[&str]) -> assert_cmd::assert::Assert {
    invoke_for(home, "Agent Board", args)
}

fn invoke_for(home: &std::path::Path, project: &str, args: &[&str]) -> assert_cmd::assert::Assert {
    let mut command = Command::cargo_bin("agboard").unwrap();
    command
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(["--project", project])
        .args(args)
        .assert()
}

fn json_of(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_slice(&assert.success().get_output().stdout).unwrap()
}

#[test]
fn agboard_requires_assignee_actor_and_reason_and_records_the_exchange() {
    let home = tempdir().unwrap();
    invoke(home.path(), &["init"]).success();
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
    // Without a data area there is no project, and nothing is created.
    let missing = invoke(home.path(), &["snapshot", "--json"])
        .failure()
        .code(4);
    let _ = missing;
    assert!(!home.path().join("board.db").exists());
    invoke(home.path(), &["init"]).success();
    let output = invoke(home.path(), &["snapshot", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    let snapshot: Value = serde_json::from_slice(&output).unwrap();
    assert!(snapshot["fetchedAt"].is_string());
    assert_eq!(snapshot["revision"], 0);
    assert_eq!(snapshot["project"]["name"], "Agent Board");
    assert_eq!(
        snapshot["cursor"],
        format!("{}:0", snapshot["project"]["id"].as_str().unwrap())
    );
    assert_eq!(snapshot["board"]["name"], "Agent Board");
    assert_eq!(snapshot["board"]["nextCardId"], 1);
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
    invoke(source.path(), &["init"]).success();
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
    // The restored data area has no project yet: import creates it by name.
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
    invoke(home.path(), &["init"]).success();
    invoke(home.path(), &["import", invalid.to_str().unwrap()]).failure();
    let board = invoke(home.path(), &["snapshot", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    assert_eq!(
        serde_json::from_slice::<Value>(&board).unwrap()["board"]["name"],
        "Agent Board"
    );
}

fn add_card(home: &std::path::Path, project: &str, title: &str) -> Value {
    json_of(invoke_for(
        home,
        project,
        &["add", title, "--assignee", "ai", "--actor", "ai", "--json"],
    ))
}

fn snapshot_of(home: &std::path::Path, project: &str) -> Value {
    json_of(invoke_for(home, project, &["snapshot", "--json"]))
}

/// Everything about a snapshot except the time it was fetched.
fn stable(mut snapshot: Value) -> Value {
    snapshot.as_object_mut().unwrap().remove("fetchedAt");
    snapshot
}

#[test]
fn two_projects_keep_the_same_card_number_apart() {
    let home = tempdir().unwrap();
    invoke_for(home.path(), "A", &["init"]).success();
    invoke_for(home.path(), "B", &["init"]).success();
    assert_eq!(add_card(home.path(), "A", "from a")["card"]["id"], 1);
    assert_eq!(add_card(home.path(), "B", "from b")["card"]["id"], 1);
    let before_b = stable(snapshot_of(home.path(), "B"));

    invoke_for(
        home.path(),
        "A",
        &["mv", "1", "doing", "--actor", "ai", "--reason", "Start"],
    )
    .success();
    let a = snapshot_of(home.path(), "A");
    assert_eq!(a["cards"][0]["title"], "from a");
    assert_eq!(a["cards"][0]["cardStatus"], "doing");
    assert_eq!(stable(snapshot_of(home.path(), "B")), before_b);
    assert_eq!(before_b["cards"][0]["cardStatus"], "todo");
    assert_ne!(a["project"]["id"], before_b["project"]["id"]);

    let shown = json_of(invoke_for(home.path(), "B", &["show", "1", "--json"]));
    assert_eq!(shown["card"]["title"], "from b");
    let listed = json_of(invoke_for(home.path(), "A", &["ls", "--json"]));
    assert_eq!(listed["cards"].as_array().unwrap().len(), 1);
}

#[test]
fn a_command_needs_a_project_that_exists_and_never_guesses_one() {
    let home = tempdir().unwrap();
    invoke_for(home.path(), "Only", &["init"]).success();
    // No --project: refused even though exactly one project exists.
    Command::cargo_bin("agboard")
        .unwrap()
        .env("SKAN_HOME", home.path())
        .args(["ls"])
        .assert()
        .failure()
        .code(2);
    // Unknown project: project_not_found, and add/mv/etc. do not create it.
    invoke_for(home.path(), "Nope", &["ls"]).failure().code(4);
    invoke_for(
        home.path(),
        "Nope",
        &["add", "x", "--assignee", "ai", "--actor", "ai"],
    )
    .failure()
    .code(4);
    // serve names no project.
    invoke_for(home.path(), "Only", &["serve", "--port", "0"])
        .failure()
        .code(2);
}

#[test]
fn init_import_and_export_touch_only_the_named_project() {
    let home = tempdir().unwrap();
    let files = tempdir().unwrap();
    let backup = files.path().join("a.json");
    invoke_for(home.path(), "A", &["init"]).success();
    invoke_for(home.path(), "B", &["init"]).success();
    add_card(home.path(), "A", "a card");
    add_card(home.path(), "B", "b card");
    let before_b = stable(snapshot_of(home.path(), "B"));

    invoke_for(
        home.path(),
        "A",
        &["export", "-o", backup.to_str().unwrap()],
    )
    .success();
    let exported: Value = serde_json::from_slice(&std::fs::read(&backup).unwrap()).unwrap();
    assert_eq!(exported["board"]["name"], "A");
    assert_eq!(exported["cards"][0]["title"], "a card");
    assert!(!exported.to_string().contains("b card"));

    // Replacing an existing project's board needs a human: refused here, and
    // nothing changes anywhere.
    let before_a = stable(snapshot_of(home.path(), "A"));
    invoke_for(home.path(), "A", &["import", backup.to_str().unwrap()])
        .failure()
        .code(1);
    invoke_for(home.path(), "A", &["init"]).failure().code(1);
    invoke_for(home.path(), "A", &["--json", "init"]).failure();
    assert_eq!(stable(snapshot_of(home.path(), "A")), before_a);
    assert_eq!(stable(snapshot_of(home.path(), "B")), before_b);

    // A backup becomes a new project only under its own name.
    invoke_for(home.path(), "C", &["import", backup.to_str().unwrap()])
        .failure()
        .code(1)
        .stderr(predicates::str::contains("not a valid board file"));
    invoke_for(home.path(), "C", &["snapshot", "--json"])
        .failure()
        .code(4);
}

#[test]
fn import_creates_a_missing_project_with_the_backup_content() {
    let source = tempdir().unwrap();
    let target = tempdir().unwrap();
    let files = tempdir().unwrap();
    let backup = files.path().join("a.json");
    invoke_for(source.path(), "A", &["init"]).success();
    add_card(source.path(), "A", "carried");
    invoke_for(
        source.path(),
        "A",
        &["export", "-o", backup.to_str().unwrap()],
    )
    .success();

    // The target already has another project; it stays as it is.
    invoke_for(target.path(), "Other", &["init"]).success();
    add_card(target.path(), "Other", "stays");
    let before_other = stable(snapshot_of(target.path(), "Other"));
    let imported = json_of(invoke_for(
        target.path(),
        "A",
        &["import", backup.to_str().unwrap(), "--json"],
    ));
    assert_eq!(imported["project"]["name"], "A");
    assert_eq!(imported["cards"][0]["title"], "carried");
    let a = snapshot_of(target.path(), "A");
    assert_eq!(a["cards"][0]["title"], "carried");
    assert_eq!(stable(snapshot_of(target.path(), "Other")), before_other);
    // Numbering continues after the imported card.
    assert_eq!(add_card(target.path(), "A", "next")["card"]["id"], 2);
}
