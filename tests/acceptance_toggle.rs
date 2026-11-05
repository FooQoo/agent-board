//! A person checking or unchecking one acceptance condition over HTTP: only
//! that condition changes, the latest file wins over what the person loaded
//! except for the condition they chose, the history records it, an AI task
//! whose conditions are then all met moves to Done, and Done stays Done.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::{Running, json_ok};
use serde_json::{Value, json};

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn task_md(home: &Path, pid: &str, id: i64) -> PathBuf {
    home.join(format!("shared/projects/{pid}/tasks/{id}/TASK.md"))
}

fn status(home: &Path, id: i64) -> String {
    json_ok(
        home,
        &["--project", "Demo", "show", &id.to_string(), "--json"],
    )["task"]["taskStatus"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A project "Demo" and a task with two conditions, in Doing, made with the
/// CLI so that each test starts the server once.
fn setup(assignee: &str) -> (tempfile::TempDir, String, i64) {
    let home = tempfile::tempdir().unwrap();
    let (code, _, err) = common::agboard(home.path(), &["project", "create", "Demo"]);
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let desc = home.path().join("task.md");
    std::fs::write(
        &desc,
        "---\nacceptance:\n- id: AC-1\n  text: First\n  done: false\n- id: AC-2\n  text: Second\n  done: false\n---\nThe plan.\n",
    )
    .unwrap();
    let added = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "add",
            "Two conditions",
            "--assignee",
            assignee,
            "--actor",
            "human",
            "--desc-file",
            desc.to_str().unwrap(),
            "--json",
        ],
    );
    let id = added["task"]["id"].as_i64().unwrap();
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &id.to_string(),
            "doing",
            "--actor",
            "human",
            "--json",
        ],
    );
    (home, pid, id)
}

fn toggle(server: &Running, pid: &str, id: i64, condition: &str, done: bool) -> common::Reply {
    server.write(
        "PUT",
        &format!("/api/projects/{pid}/tasks/{id}/acceptance/{condition}"),
        Some(&json!({ "done": done }).to_string()),
    )
}

fn done_of(task: &Value, condition: &str) -> bool {
    task["acceptance"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == condition)
        .unwrap()["done"]
        .as_bool()
        .unwrap()
}

#[test]
fn checking_one_condition_changes_only_it_and_records_who_did() {
    let (home, pid, id) = setup("human");
    let server = Running::start(home.path());
    let reply = toggle(&server, &pid, id, "AC-1", true);
    assert_eq!(reply.status, 200, "{}", reply.body);
    let task = &reply.json()["task"];
    assert!(done_of(task, "AC-1"));
    assert!(!done_of(task, "AC-2"));
    assert_eq!(task["body"].as_str().unwrap().trim_end(), "The plan.");
    let last = task["history"].as_array().unwrap().last().unwrap().clone();
    assert!(last["reason"].as_str().unwrap().contains("AC-1"), "{last}");
    // The same value again changes nothing.
    let again = toggle(&server, &pid, id, "AC-1", true);
    assert_eq!(again.status, 200, "{}", again.body);
    assert_eq!(again.json()["task"]["history"], task["history"]);
    server.stop();
}

#[test]
fn a_japanese_task_records_that_the_user_made_the_change() {
    let (home, pid, id) = setup("human");
    let desc = home.path().join("ja.md");
    std::fs::write(
        &desc,
        "---\nacceptance:\n- id: AC-1\n  text: 一つ目\n  done: false\n- id: AC-2\n  text: 二つ目\n  done: false\n---\n日本語の計画。\n",
    )
    .unwrap();
    json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "edit",
            &id.to_string(),
            "--desc-file",
            desc.to_str().unwrap(),
            "--json",
        ],
    );
    let server = Running::start(home.path());
    let last_reason = |reply: common::Reply| {
        assert_eq!(reply.status, 200, "{}", reply.body);
        reply.json()["task"]["history"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["reason"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_eq!(
        last_reason(toggle(&server, &pid, id, "AC-1", true)),
        "ユーザーがAC-1を達成にしました。"
    );
    assert_eq!(
        last_reason(toggle(&server, &pid, id, "AC-1", false)),
        "ユーザーがAC-1を未達成に戻しました。"
    );
    server.stop();
}

#[test]
fn the_persons_choice_wins_and_a_change_made_meanwhile_is_kept() {
    let (home, pid, id) = setup("human");
    let server = Running::start(home.path());
    // An agent edits the file after the person loaded the task: it checks
    // AC-1 and AC-2 and rewrites the body.
    let path = task_md(home.path(), &pid, id);
    let text = std::fs::read_to_string(&path).unwrap();
    let edited = text
        .replace("done: false", "done: true")
        .replace("The plan.", "The plan, revised by the agent.");
    std::fs::write(&path, edited).unwrap();
    // The person unchecks AC-1, as they saw it.
    let reply = toggle(&server, &pid, id, "AC-1", false);
    assert_eq!(reply.status, 200, "{}", reply.body);
    let task = &reply.json()["task"];
    assert!(!done_of(task, "AC-1"), "the person's choice wins");
    assert!(done_of(task, "AC-2"), "the agent's other change is kept");
    assert_eq!(
        task["body"].as_str().unwrap().trim_end(),
        "The plan, revised by the agent."
    );
    server.stop();
}

#[test]
fn an_ai_task_moves_to_done_when_a_person_checks_the_last_condition() {
    let (home, pid, id) = setup("ai");
    let server = Running::start(home.path());
    assert_eq!(toggle(&server, &pid, id, "AC-1", true).status, 200);
    assert_eq!(status(home.path(), id), "doing");
    assert_eq!(toggle(&server, &pid, id, "AC-2", true).status, 200);
    let deadline = Instant::now() + Duration::from_secs(20);
    while status(home.path(), id) != "done" {
        assert!(Instant::now() < deadline, "the task did not move to Done");
        std::thread::sleep(Duration::from_millis(100));
    }
    // Unchecking afterwards keeps it in Done.
    let reply = toggle(&server, &pid, id, "AC-2", false);
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(!done_of(&reply.json()["task"], "AC-2"));
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(status(home.path(), id), "done");
    server.stop();
}

#[test]
fn an_unknown_condition_and_an_archived_task_are_refused() {
    let (home, pid, id) = setup("human");
    let server = Running::start(home.path());
    let reply = toggle(&server, &pid, id, "AC-9", true);
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_argument");
    let before = std::fs::read_to_string(task_md(home.path(), &pid, id)).unwrap();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{pid}/tasks/{id}/archive"),
        Some("{}"),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    let reply = toggle(&server, &pid, id, "AC-1", true);
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "task_archived");
    let after = std::fs::read_to_string(task_md(home.path(), &pid, id)).unwrap();
    assert_eq!(after.contains("done: true"), before.contains("done: true"));
    server.stop();
}

#[test]
fn a_bad_body_is_refused_without_a_change() {
    let (home, pid, id) = setup("human");
    let server = Running::start(home.path());
    let before = std::fs::read_to_string(task_md(home.path(), &pid, id)).unwrap();
    for body in [r#"{}"#, r#"{"done":"yes"}"#, r#"{"done":true,"extra":1}"#] {
        let reply = server.write(
            "PUT",
            &format!("/api/projects/{pid}/tasks/{id}/acceptance/AC-1"),
            Some(body),
        );
        assert!(reply.status >= 400, "{body}: {}", reply.body);
    }
    assert_eq!(
        std::fs::read_to_string(task_md(home.path(), &pid, id)).unwrap(),
        before
    );
    server.stop();
}
