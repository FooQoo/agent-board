//! An open request reaches an agent: it is in the progress table, in the hook's progress
//! output, and it ends a listening `wait --until task`. Every test uses a temporary data area.

mod common;

use std::io::Cursor;

use common::{agboard, json_ok};
use serde_json::Value;

fn project(home: &std::path::Path) {
    let (code, _, err) = agboard(home, &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
}

fn send(home: &std::path::Path, text: &str) -> String {
    let sent = json_ok(
        home,
        &[
            "--project",
            "Demo",
            "message",
            "send",
            "--actor",
            "human",
            "--text",
            text,
            "--json",
        ],
    );
    sent["request"]["id"].as_str().unwrap().to_string()
}

fn progress(home: &std::path::Path) -> Value {
    json_ok(home, &["--project", "Demo", "progress", "--json"])
}

#[test]
fn an_open_request_is_in_progress_with_a_short_title_and_leaves_when_accepted() {
    let home = tempfile::tempdir().unwrap();
    project(home.path());
    assert!(
        progress(home.path()).get("requests").is_none(),
        "no request, no field"
    );

    let id = send(home.path(), "# Add a reset link\n\nOn the login page.");
    let listed = progress(home.path());
    let requests = listed["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["id"], id.as_str());
    assert_eq!(requests[0]["title"], "Add a reset link");
    assert!(requests[0]["createdAt"].as_str().unwrap().ends_with('Z'));
    assert!(requests[0].get("body").is_none());

    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "accept",
            &id,
            "--actor",
            "ai",
            "--by",
            "session-1",
            "--json",
        ],
    );
    assert!(progress(home.path()).get("requests").is_none());
}

#[test]
fn a_withdrawn_request_is_not_listed_and_a_long_first_line_is_cut() {
    let home = tempfile::tempdir().unwrap();
    project(home.path());
    let gone = send(home.path(), "Never mind");
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "withdraw",
            &gone,
            "--actor",
            "human",
            "--json",
        ],
    );
    let long = send(home.path(), &format!("{}\nsecond line", "あ".repeat(300)));
    let listed = progress(home.path());
    let requests = listed["requests"].as_array().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["id"], long.as_str());
    let title = requests[0]["title"].as_str().unwrap();
    assert_eq!(title.chars().count(), 81, "80 characters and an ellipsis");
    assert!(title.ends_with('…'));
}

#[test]
fn the_hook_carries_the_open_requests() {
    let home = tempfile::tempdir().unwrap();
    project(home.path());
    let id = send(home.path(), "Fix the typo");
    let input = r#"{"hook_event_name":"SessionStart"}"#;
    let out = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(input),
        &home.path().join("shared"),
        Some("Demo"),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&out).unwrap();
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    let table: Value =
        serde_json::from_str(context.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap();
    assert_eq!(table["requests"][0]["id"], id.as_str());
    assert_eq!(table["requests"][0]["title"], "Fix the typo");
}

#[test]
fn listening_returns_an_open_request_before_any_task() {
    let home = tempfile::tempdir().unwrap();
    project(home.path());
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "add",
            "Work",
            "--assignee",
            "ai",
            "--actor",
            "human",
            "--json",
        ],
    );
    let id = send(home.path(), "Please look at this first");
    let out = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "30",
        ],
    );
    assert_eq!(out["kind"], "requests");
    assert_eq!(out["requests"][0]["id"], id.as_str());
    assert_eq!(out["requests"][0]["title"], "Please look at this first");
    assert!(out["cursor"].is_string());
    assert!(out["projectId"].is_string());

    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "accept",
            &id,
            "--actor",
            "ai",
            "--by",
            "session-1",
            "--json",
        ],
    );
    let out = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "30",
        ],
    );
    assert_eq!(
        out["kind"], "task",
        "the request is accepted, the task comes"
    );
}
