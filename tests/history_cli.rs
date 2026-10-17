mod common;

use common::{Running, demo_project, json_error, json_ok};

fn last_reason(task: &serde_json::Value) -> &str {
    let entry = task["history"].as_array().unwrap().last().unwrap();
    assert_eq!(entry.as_object().unwrap().len(), 2);
    assert!(entry["at"].as_str().unwrap().ends_with('Z'));
    entry["reason"].as_str().unwrap()
}

#[test]
fn real_cli_appends_verbatim_notes_or_defaults_and_preserves_lane_timing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let initial = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let note = "  Implemented request response lookup.\nVerified restart.  ";
    let appended = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "history",
            "add",
            "1",
            "--reason",
            note,
            "--json",
        ],
    );
    assert_eq!(last_reason(&appended["task"]), note);
    assert_eq!(
        appended["task"]["taskStatusChangedAt"],
        initial["task"]["taskStatusChangedAt"]
    );
    let file = home.path().join("reason.txt");
    std::fs::write(&file, "Validated stored answers after restart.\n").unwrap();
    let appended = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "history",
            "add",
            "1",
            "--reason-file",
            file.to_str().unwrap(),
            "--json",
        ],
    );
    assert_eq!(
        last_reason(&appended["task"]),
        "Validated stored answers after restart.\n"
    );
    for suffix in [vec![], vec!["--reason", "  "]] {
        let args = [
            vec!["--project", "Demo", "history", "add", "1", "--json"],
            suffix,
        ]
        .concat();
        let appended = json_ok(home.path(), &args);
        assert_eq!(
            last_reason(&appended["task"]),
            "Progress note in Doing; agent is idle."
        );
    }
    let running = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--json",
        ],
    );
    assert_eq!(
        last_reason(&running["task"]),
        "Changed agent from idle to running in Doing."
    );
    let no_op = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "",
            "--json",
        ],
    );
    assert_eq!(running["task"]["history"], no_op["task"]["history"]);
    let moved = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "todo",
            "--actor",
            "human",
            "--reason",
            " ",
            "--json",
        ],
    );
    assert_eq!(
        last_reason(&moved["task"]),
        "Moved task from Doing to Todo; agent is idle."
    );
}

#[test]
fn history_add_enforces_write_guards_and_reports_bad_arguments() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    assert_eq!(
        json_error(home.path(), &["--project", "Demo", "history", "add", "999"]),
        (3, "task_not_found".into())
    );
    assert_eq!(
        json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "history",
                "add",
                "1",
                "--reason",
                &"x".repeat(10_001)
            ]
        ),
        (2, "invalid_value".into())
    );
    assert_eq!(
        json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "history",
                "add",
                "1",
                "--reason",
                "x",
                "--reason-file",
                "missing"
            ]
        ),
        (2, "invalid_argument".into())
    );
    assert_eq!(
        json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "history",
                "add",
                "1",
                "--actor",
                "human"
            ]
        ),
        (2, "invalid_argument".into())
    );
    let server = Running::start(home.path());
    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    let project = snapshot["project"]["id"].as_str().unwrap();
    let task_path = format!("/api/projects/{project}/tasks/1");
    let draft = server.write(
        "PUT",
        &format!("{task_path}/draft"),
        Some(r#"{"isDraft":true}"#),
    );
    assert_eq!(draft.status, 200, "{}", draft.body);
    assert_eq!(
        json_error(home.path(), &["--project", "Demo", "history", "add", "1"]),
        (1, "task_is_draft".into())
    );
    server.write(
        "PUT",
        &format!("{task_path}/draft"),
        Some(r#"{"isDraft":false}"#),
    );
    server.write("POST", &format!("{task_path}/archive"), None);
    assert_eq!(
        json_error(home.path(), &["--project", "Demo", "history", "add", "1"]),
        (1, "task_archived".into())
    );
    server.write("POST", &format!("{task_path}/restore"), None);
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "done",
            "--actor",
            "human",
            "--json",
        ],
    );
    assert_eq!(
        json_error(home.path(), &["--project", "Demo", "history", "add", "1"]),
        (1, "task_is_done".into())
    );
}

#[test]
fn real_server_generates_optional_operation_reasons_but_rejects_blank_questions() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    let project = snapshot["project"]["id"].as_str().unwrap();
    let task_path = format!("/api/projects/{project}/tasks/1");
    let running = server.write(
        "POST",
        &format!("{task_path}/agent-status"),
        Some(r#"{"agentStatus":"running"}"#),
    );
    assert_eq!(running.status, 200, "{}", running.body);
    assert_eq!(
        last_reason(&running.json()["task"]),
        "Changed agent from idle to running in Doing."
    );
    let invalid = server.write(
        "POST",
        &format!("{task_path}/agent-status"),
        Some(r#"{"agentStatus":"pending","reason":" "}"#),
    );
    assert_eq!(invalid.status, 422, "{}", invalid.body);
    let moved = server.write(
        "POST",
        &format!("{task_path}/move"),
        Some(r#"{"taskStatus":"todo"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    assert_eq!(
        last_reason(&moved.json()["task"]),
        "Moved task from Doing to Todo; agent is idle."
    );
}
