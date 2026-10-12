use assert_cmd::Command;

mod common;
use serde_json::Value;
use tempfile::tempdir;

/// Run `agboard --project "Agent Board" <args>`.
fn invoke(home: &std::path::Path, args: &[&str]) -> assert_cmd::assert::Assert {
    invoke_for(home, "Agent Board", args)
}

fn invoke_for(home: &std::path::Path, project: &str, args: &[&str]) -> assert_cmd::assert::Assert {
    let mut command = Command::cargo_bin("agboard").unwrap();
    command
        .env("AGBOARD_HOME", home)
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
            "--request-json",
            &common::decision_json("Need input"),
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

/// A TASK.md body of exactly `count` characters that the file store accepts:
/// the required headings and one completion condition, padded with `fill`.
fn body_of(count: usize, fill: char) -> String {
    const HEAD: &str = "## 作業内容\n\n";
    const TAIL: &str = "\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";
    let fixed = HEAD.chars().count() + TAIL.chars().count();
    format!("{HEAD}{}{TAIL}", fill.to_string().repeat(count - fixed))
}

#[test]
fn snapshot_is_read_only_and_returns_full_history() {
    let home = tempdir().unwrap();
    // Without a data area there is no project, and nothing is created.
    let missing = invoke(home.path(), &["snapshot", "--json"])
        .failure()
        .code(4);
    let _ = missing;
    invoke(home.path(), &["init"]).success();
    let output = invoke(home.path(), &["snapshot", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    let snapshot: Value = serde_json::from_slice(&output).unwrap();
    assert!(snapshot["fetchedAt"].is_string());
    assert_eq!(snapshot["project"]["name"], "Agent Board");
    let version = snapshot["version"].as_str().unwrap();
    assert_eq!(version.len(), 32);
    assert_eq!(
        snapshot["cursor"],
        format!(
            "f1:{}:{version}",
            snapshot["project"]["id"].as_str().unwrap()
        )
    );
    assert_eq!(snapshot["nextCardId"], 1);
    assert_eq!(snapshot["cards"].as_array().unwrap().len(), 0);
    assert_eq!(snapshot["problems"].as_array().unwrap().len(), 0);
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
        .env("AGBOARD_HOME", home.path())
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

/// Mark a card as a draft the way the Web does, through the file store.
fn make_draft(home: &std::path::Path, project: &str, id: i64) {
    let files = agent_board::file_store::FileStore::open(&home.join("shared"));
    let meta = files.project_by_name(project).unwrap();
    files
        .set_draft(&meta.id, id, true, chrono::Utc::now())
        .unwrap();
}

fn invoke_none(home: &std::path::Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .assert()
}

fn stdout_of(assert: assert_cmd::assert::Assert) -> String {
    String::from_utf8(assert.success().get_output().stdout.clone()).unwrap()
}

#[test]
fn ls_and_show_mark_drafts_and_json_carries_is_draft() {
    let home = tempdir().unwrap();
    assert!(invoke(home.path(), &["init"]).get_output().status.success());
    add_card(home.path(), "Agent Board", "Plain");
    add_card(home.path(), "Agent Board", "Sketch");
    make_draft(home.path(), "Agent Board", 2);

    let text = stdout_of(invoke(home.path(), &["ls"]));
    assert!(text.contains("  #1 Plain [AI]\n"), "{text}");
    assert!(text.contains("  #2 Sketch [AI] [draft]\n"), "{text}");
    let filtered = stdout_of(invoke(
        home.path(),
        &["ls", "--column", "todo", "--state", "idle"],
    ));
    assert!(filtered.contains("#2 Sketch [AI] [draft]"));
    assert!(!stdout_of(invoke(home.path(), &["ls", "--column", "doing"])).contains("[draft]"));

    let listed = json_of(invoke(home.path(), &["ls", "--json"]));
    assert_eq!(listed["cards"][0]["isDraft"], false);
    assert_eq!(listed["cards"][1]["isDraft"], true);
    let all = json_of(invoke_none(
        home.path(),
        &["ls", "--all-projects", "--json"],
    ));
    assert_eq!(all["projects"][0]["cards"][1]["isDraft"], true);
    let all_text = stdout_of(invoke_none(home.path(), &["ls", "--all-projects"]));
    assert!(all_text.contains("#2 Sketch [AI] [draft]"));

    let shown = stdout_of(invoke(home.path(), &["show", "2"]));
    assert!(shown.contains("Draft: yes\n"), "{shown}");
    assert!(!stdout_of(invoke(home.path(), &["show", "1"])).contains("Draft"));
    assert_eq!(
        json_of(invoke(home.path(), &["show", "2", "--json"]))["card"]["isDraft"],
        true
    );
    assert_eq!(
        snapshot_of(home.path(), "Agent Board")["cards"][1]["isDraft"],
        true
    );
}

#[test]
fn a_draft_refuses_edit_mv_and_state_and_changes_and_announces_nothing() {
    use std::io::ErrorKind;
    let home = tempdir().unwrap();
    assert!(invoke(home.path(), &["init"]).get_output().status.success());
    add_card(home.path(), "Agent Board", "Sketch");
    make_draft(home.path(), "Agent Board", 1);
    let before = stable(snapshot_of(home.path(), "Agent Board"));

    // A fake `serve` that must never be told about a refused command.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    std::fs::write(
        home.path().join("serve.json"),
        format!(
            r#"{{"pid":{},"port":{port},"started_at":"2026-10-02T01:00:00Z"}}"#,
            std::process::id()
        ),
    )
    .unwrap();

    let attempts: [&[&str]; 4] = [
        &["edit", "1", "--title", "New"],
        &["edit", "1", "--desc", "New"],
        &["mv", "1", "doing", "--actor", "ai", "--reason", "Start"],
        &["state", "1", "running", "--actor", "ai", "--reason", "Work"],
    ];
    for args in attempts {
        let human = invoke(home.path(), args).failure().code(1);
        let stderr = String::from_utf8(human.get_output().stderr.clone()).unwrap();
        assert!(stderr.starts_with("Error: card #1 is a draft"), "{stderr}");
        assert!(
            stderr.contains("Wait for the user to finalize it"),
            "{stderr}"
        );
        let mut json_args = args.to_vec();
        json_args.push("--json");
        let json = invoke(home.path(), &json_args).failure().code(1);
        let value: Value = serde_json::from_slice(&json.get_output().stderr).unwrap();
        assert_eq!(value["error"]["code"], "card_is_draft");
    }
    assert_eq!(before, stable(snapshot_of(home.path(), "Agent Board")));
    assert_eq!(
        listener.accept().err().map(|e| e.kind()),
        Some(ErrorKind::WouldBlock)
    );

    // Reading and adding still work while a draft exists.
    assert!(
        invoke(home.path(), &["show", "1"])
            .get_output()
            .status
            .success()
    );
    assert!(invoke(home.path(), &["ls"]).get_output().status.success());
    add_card(home.path(), "Agent Board", "Another");
    assert_eq!(
        snapshot_of(home.path(), "Agent Board")["cards"][1]["isDraft"],
        false
    );
}

#[test]
fn descriptions_up_to_the_limit_pass_through_every_input() {
    let home = tempdir().unwrap();
    assert!(invoke(home.path(), &["init"]).get_output().status.success());
    let text = body_of(50000, 'あ');
    let added = json_of(invoke(
        home.path(),
        &[
            "add",
            "Long",
            "--desc",
            &text,
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--json",
        ],
    ));
    assert_eq!(
        added["card"]["description"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        50_000
    );
    let file = home.path().join("desc.md");
    std::fs::write(&file, format!("{}\n", body_of(50_000, 'い'))).unwrap();
    let edited = json_of(invoke(
        home.path(),
        &["edit", "1", "--desc-file", file.to_str().unwrap(), "--json"],
    ));
    assert_eq!(edited["card"]["description"], body_of(50000, 'い').as_str());
    let piped = Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home.path())
        .args([
            "--project",
            "Agent Board",
            "edit",
            "1",
            "--desc",
            "-",
            "--json",
        ])
        .write_stdin(body_of(50000, 'う'))
        .assert();
    // The description is stored trimmed of its outer whitespace (as before the switch).
    assert_eq!(
        json_of(piped)["card"]["description"]
            .as_str()
            .unwrap()
            .trim(),
        body_of(50000, 'う').trim()
    );
    let shown = json_of(invoke(home.path(), &["show", "1", "--json"]));
    assert_eq!(
        shown["card"]["description"]
            .as_str()
            .unwrap()
            .trim()
            .chars()
            .count(),
        body_of(50_000, 'う').trim().chars().count()
    );
    let over = invoke(
        home.path(),
        &["edit", "1", "--desc", &body_of(50001, 'え'), "--json"],
    )
    .failure();
    let value: Value = serde_json::from_slice(&over.get_output().stderr).unwrap();
    assert_eq!(value["error"]["code"], "invalid_value");
}

#[test]
fn help_describes_markdown_limits_and_drafts() {
    let help = |args: &[&str]| {
        let out = Command::cargo_bin("agboard")
            .unwrap()
            .args(args)
            .assert()
            .success();
        String::from_utf8(out.get_output().stdout.clone()).unwrap()
    };
    let top = help(&["--help"]);
    for needle in [
        "isDraft",
        "card_is_draft",
        "read-only",
        "--desc-file",
        "in full",
    ] {
        assert!(top.contains(needle), "top help lacks {needle}");
    }
    for sub in ["add", "edit"] {
        let text = help(&[sub, "--help"]);
        assert!(text.contains("Markdown"), "{sub}: {text}");
        assert!(text.contains("50,000"), "{sub}: {text}");
    }
    assert!(help(&["edit", "--help"]).contains("card_is_draft"));
}
