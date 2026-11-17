//! An answer no agent has taken in reaches an agent: it is in the progress table, in the hook,
//! and it ends a listening `wait --until task`, until an agent accepts it. A wait that returns
//! an answer accepts it. Every test uses a temporary data area.

mod common;

use std::io::Cursor;

use common::{agboard, json_ok};
use serde_json::Value;

const P: [&str; 2] = ["--project", "Demo"];

fn run(home: &std::path::Path, args: &[&str]) -> Value {
    let all: Vec<&str> = P.iter().copied().chain(args.iter().copied()).collect();
    json_ok(home, &all)
}

/// A project with one AI task and one question asked for it, answered by a person.
fn answered(home: &std::path::Path) -> String {
    let (code, _, err) = agboard(home, &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    let task = run(
        home,
        &[
            "add",
            "Work",
            "--assignee",
            "ai",
            "--actor",
            "human",
            "--json",
        ],
    );
    let task = task["task"]["id"].to_string();
    let asked = run(
        home,
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            &task,
            "--questions-json",
            r##"{"questions":[{"body":"# Which colour?\nFor the header.","choices":[{"id":"blue","label":"Blue"},{"id":"red","label":"Red"}]}]}"##,
            "--no-wait",
            "--json",
        ],
    );
    let id = asked["questions"][0]["id"].as_str().unwrap().to_string();
    run(
        home,
        &[
            "message", "answer", &id, "--actor", "human", "--via", "cli", "--choice", "blue",
            "--json",
        ],
    );
    id
}

fn progress(home: &std::path::Path) -> Value {
    run(home, &["progress", "--json"])
}

#[test]
fn an_unaccepted_answer_is_in_progress_and_leaves_when_accepted() {
    let home = tempfile::tempdir().unwrap();
    let id = answered(home.path());
    let table = progress(home.path());
    let answers = table["answers"].as_array().unwrap();
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0]["id"], id.as_str());
    assert_eq!(answers[0]["title"], "Which colour?");
    assert_eq!(answers[0]["choiceId"], "blue");
    assert_eq!(answers[0]["choiceLabel"], "Blue");
    assert_eq!(answers[0]["tasks"], serde_json::json!([1]));
    assert!(answers[0]["answeredAt"].as_str().unwrap().ends_with('Z'));

    let accepted = run(
        home.path(),
        &["message", "accept", &id, "--actor", "ai", "--json"],
    );
    assert!(accepted["question"]["reply"]["acceptedAt"].is_string());
    assert!(progress(home.path()).get("answers").is_none());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "message",
            "accept",
            &id,
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 1);
    assert!(err.contains("answer_accepted"), "{err}");
}

#[test]
fn the_hook_carries_the_unaccepted_answers() {
    let home = tempfile::tempdir().unwrap();
    let id = answered(home.path());
    let out = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(r#"{"hook_event_name":"SessionStart"}"#),
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
    assert_eq!(table["answers"][0]["id"], id.as_str());
    assert_eq!(table["answers"][0]["choiceLabel"], "Blue");
}

#[test]
fn listening_returns_an_answer_before_any_task_until_it_is_accepted() {
    let home = tempfile::tempdir().unwrap();
    let id = answered(home.path());
    let listen = ["--json", "wait", "--until", "task", "--idle-timeout", "30"];
    let out = run(home.path(), &listen);
    assert_eq!(out["kind"], "answers");
    assert_eq!(out["answers"][0]["id"], id.as_str());
    let again = run(home.path(), &listen);
    assert_eq!(again["kind"], "answers", "returned until it is accepted");

    run(
        home.path(),
        &["message", "accept", &id, "--actor", "ai", "--json"],
    );
    assert_eq!(run(home.path(), &listen)["kind"], "task");
}

#[test]
fn a_wait_that_returns_the_answer_accepts_it() {
    let home = tempfile::tempdir().unwrap();
    let id = answered(home.path());
    let (code, out, err) = agboard(
        home.path(),
        &["--project", "Demo", "--json", "message", "wait", &id],
    );
    assert_eq!(code, 0, "{out}{err}");
    let last: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
    assert_eq!(last["type"], "answered");
    assert_eq!(last["answers"][0]["choiceId"], "blue");
    assert!(progress(home.path()).get("answers").is_none());
    let shown = run(home.path(), &["message", "show", &id, "--json"]);
    assert!(shown["question"]["reply"]["acceptedAt"].is_string());
}
