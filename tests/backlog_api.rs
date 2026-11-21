//! Backlog over HTTP and the CLI: creating a plan in the Backlog and sending it to Todo are
//! different operations. Every test uses a temporary data area; servers listen on port 0.

mod common;

use std::path::Path;

use common::{Running, agboard, json_error, json_ok};
use serde_json::{Value, json};

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn run(home: &Path, args: &[&str]) -> Value {
    let mut all = vec!["--project", "Demo"];
    all.extend(args);
    all.push("--json");
    json_ok(home, &all)
}

#[test]
fn creating_in_the_backlog_and_sending_to_todo_are_different_operations() {
    let home = tempfile::tempdir().unwrap();
    let (code, _, err) = agboard(home.path(), &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");

    // A plan-only request: the agent creates in the Backlog. An execute request: in Todo.
    let plan = run(
        home.path(),
        &[
            "add",
            "Plan",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--backlog",
        ],
    );
    assert_eq!(plan["task"]["taskStatus"], "backlog");
    let execute = run(
        home.path(),
        &["add", "Run", "--assignee", "ai", "--actor", "ai"],
    );
    assert_eq!(execute["task"]["taskStatus"], "todo");

    // The agent cannot take it out of the Backlog, by `send` or by `mv`.
    for args in [
        vec!["send", "1", "--actor", "ai", "--json"],
        vec![
            "mv", "1", "todo", "--actor", "ai", "--reason", "go", "--json",
        ],
        vec![
            "mv", "1", "doing", "--actor", "ai", "--reason", "go", "--json",
        ],
    ] {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        let (code, name) = json_error(home.path(), &all);
        assert_eq!(code, 1);
        assert!(name == "human_only" || name == "task_in_backlog", "{name}");
    }

    // A person sends it; the card is at the end of Todo.
    let sent = run(home.path(), &["send", "1", "--actor", "human"]);
    assert_eq!(sent["task"]["taskStatus"], "todo");
}

#[test]
fn the_api_sends_a_card_and_the_cards_of_an_epic_with_the_warning_for_open_questions() {
    let home = tempfile::tempdir().unwrap();
    let (code, _, err) = agboard(home.path(), &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    run(
        home.path(),
        &["epic", "add", "PLAN", "--name", "Plan", "--actor", "ai"],
    );
    for title in ["A", "B", "C"] {
        run(
            home.path(),
            &[
                "add",
                title,
                "--assignee",
                "ai",
                "--actor",
                "ai",
                "--backlog",
                "--epic",
                "PLAN",
            ],
        );
    }
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "2",
            "--questions-json",
            r#"{"questions":[{"body":"Which?"}]}"#,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let base = format!("/api/projects/{pid}");

    // The first card has no question: sent. A bad body is refused.
    let reply = server.write("POST", &format!("{base}/tasks/1/send"), Some("{}"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["taskStatus"], "todo");
    assert_eq!(reply.json()["changed"], true);
    let again = server.write("POST", &format!("{base}/tasks/1/send"), Some("{}"));
    assert_eq!(again.json()["changed"], false, "a retry changes nothing");
    let bad = server.write("POST", &format!("{base}/tasks/2/send"), Some(r#"{"x":1}"#));
    assert_eq!(bad.status, 400, "{}", bad.body);

    // The epic send names the open question and sends nothing until `ack`.
    let warned = server.write("POST", &format!("{base}/epics/PLAN/send"), Some("{}"));
    assert_eq!(warned.status, 409, "{}", warned.body);
    assert_eq!(warned.code(), "send_with_open_questions");
    let one = server.write(
        "POST",
        &format!("{base}/epics/PLAN/send"),
        Some(&json!({"taskIds": [3]}).to_string()),
    );
    assert_eq!(one.status, 200, "{}", one.body);
    assert_eq!(one.json()["sent"], json!([3]));
    let all = server.write(
        "POST",
        &format!("{base}/epics/PLAN/send"),
        Some(r#"{"ack":true}"#),
    );
    assert_eq!(all.status, 200, "{}", all.body);
    assert_eq!(all.json()["sent"], json!([2]));
    server.stop();
}
