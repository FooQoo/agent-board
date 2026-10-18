//! Atomic simple-request creation over the existing multipart task endpoint.

mod common;

use std::path::Path;

use common::{Reply, Running, agboard, demo_project, multipart, png};
use serde_json::{Value, json};

const BOUNDARY: &str = "agboard-simple-request";
const REQUEST_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IMAGE_ID: &str = "0123456789abcdef0123456789abcdef";

fn project_id(home: &Path) -> String {
    common::json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn task_count(server: &Running, pid: &str) -> usize {
    let reply = server.get(&format!("/api/projects/{pid}/board"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    serde_json::from_str::<Value>(&reply.body).unwrap()["tasks"]
        .as_array()
        .unwrap()
        .len()
}

fn send(server: &Running, pid: &str, text: &str, epic_id: Option<&str>, image: bool) -> Reply {
    let mut metadata = json!({
        "requestId": REQUEST_ID,
        "requestKind": "simple",
        "description": text,
    });
    if let Some(epic_id) = epic_id {
        metadata["epicId"] = json!(epic_id);
    }
    let attachment_meta = if image {
        vec![json!({"id": IMAGE_ID, "name": "note.png"})]
    } else {
        vec![]
    };
    metadata["attachments"] = json!(attachment_meta);
    let metadata = metadata.to_string();
    let files = if image {
        vec![("file", "note.png", png())]
    } else {
        vec![]
    };
    let parts: Vec<_> = files
        .iter()
        .map(|(name, file, bytes)| (*name, *file, bytes.as_slice()))
        .collect();
    let body = multipart(BOUNDARY, &[("metadata", &metadata)], &parts);
    server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/multipart"),
        body,
        BOUNDARY,
    )
}

fn task(reply: &Reply, expected_status: u16) -> Value {
    assert_eq!(reply.status, expected_status, "{}", reply.body);
    serde_json::from_str::<Value>(&reply.body).unwrap()["task"].clone()
}

#[test]
fn a_simple_request_can_belong_to_an_existing_epic() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "TASK-LISTEN",
            "--name",
            "Task listening",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let task = task(
        &send(&server, &pid, "Request", Some("TASK-LISTEN"), false),
        201,
    );
    assert_eq!(task["epicId"], "TASK-LISTEN");
    assert_eq!(task["epic"]["name"], "Task listening");
}

#[test]
fn simple_request_publishes_body_and_image_together_and_replays_idempotently() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let first = task(
        &send(&server, &pid, "Build the thing\nDetails", None, true),
        201,
    );
    assert_eq!(first["title"], "Build the thing");
    assert_eq!(first["assignee"], "ai");
    assert_eq!(first["isDraft"], false);
    assert_eq!(first["attachments"].as_array().unwrap().len(), 1);
    assert!(first["description"].as_str().unwrap().contains("元の依頼"));
    assert_eq!(task_count(&server, &pid), before + 1);

    let replay = task(
        &send(&server, &pid, "Build the thing\nDetails", None, true),
        200,
    );
    assert_eq!(replay["id"], first["id"]);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn same_request_id_with_different_content_conflicts_without_publishing_another_task() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);
    task(&send(&server, &pid, "First", None, false), 201);

    let conflict = send(&server, &pid, "Changed", None, false);
    assert_eq!(conflict.status, 409, "{}", conflict.body);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn simultaneous_retries_with_the_same_request_id_publish_only_one_task() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let (first, second) = std::thread::scope(|scope| {
        let one = scope.spawn(|| send(&server, &pid, "Concurrent", None, false));
        let two = scope.spawn(|| send(&server, &pid, "Concurrent", None, false));
        (one.join().unwrap(), two.join().unwrap())
    });
    assert!([201, 200].contains(&first.status), "{}", first.body);
    assert!([201, 200].contains(&second.status), "{}", second.body);
    let first_task = serde_json::from_str::<Value>(&first.body).unwrap()["task"]["id"].clone();
    let second_task = serde_json::from_str::<Value>(&second.body).unwrap()["task"]["id"].clone();
    assert_eq!(first_task, second_task);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn a_deleted_epic_is_rejected_before_any_task_is_visible() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let reply = send(&server, &pid, "Request", Some("TASK-NOT-FOUND"), false);
    assert_eq!(reply.status, 404, "{}", reply.body);
    assert_eq!(task_count(&server, &pid), before);
}
