//! Atomic simple-request creation over the existing multipart task endpoint.

mod common;

use std::fs;
use std::path::Path;

use common::{Reply, Running, agboard, demo_project, multipart, png};
use serde_json::{Value, json};

const BOUNDARY: &str = "agboard-simple-request";
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
    let images = if image { vec![png()] } else { vec![] };
    send_images(server, pid, text, epic_id, images)
}

fn send_images(
    server: &Running,
    pid: &str,
    text: &str,
    epic_id: Option<&str>,
    images: Vec<Vec<u8>>,
) -> Reply {
    let mut metadata = json!({
        "requestKind": "simple",
        "description": text,
    });
    if let Some(epic_id) = epic_id {
        metadata["epicId"] = json!(epic_id);
    }
    let attachment_meta: Vec<_> = images
        .iter()
        .enumerate()
        .map(|(index, _)| json!({"id": format!("{:032x}", index + 1), "name": format!("note-{}.png", index + 1)}))
        .collect();
    metadata["attachments"] = json!(attachment_meta);
    let metadata = metadata.to_string();
    let filenames: Vec<_> = images
        .into_iter()
        .enumerate()
        .map(|(index, bytes)| (format!("note-{}.png", index + 1), bytes))
        .collect();
    let parts: Vec<_> = filenames
        .iter()
        .map(|(filename, bytes)| ("file", filename.as_str(), bytes.as_slice()))
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

    let before = task_count(&server, &pid);
    let task = task(
        &send(&server, &pid, "Request", Some("TASK-LISTEN"), false),
        201,
    );
    assert_eq!(task["epicId"], "TASK-LISTEN");
    assert_eq!(task["epic"]["name"], "Task listening");
    assert_eq!(task["attachments"].as_array().unwrap().len(), 0);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn a_simple_request_truncates_unicode_title_to_the_task_title_limit() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let expected_title = format!("{}🌱", "界".repeat(99));
    let first_line = format!("{expected_title}終");
    assert_eq!(first_line.chars().count(), 101);

    let created = task(&send(&server, &pid, &first_line, None, false), 201);
    let title = created["title"].as_str().unwrap();
    assert_eq!(title, expected_title);
    assert_eq!(title.chars().count(), 100);
}

#[test]
fn simple_request_publishes_body_and_each_submission_creates_a_task() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let images = vec![png(), png()];
    let first = task(
        &send_images(
            &server,
            &pid,
            "Build the thing\nDetails",
            None,
            images.clone(),
        ),
        201,
    );
    assert_eq!(first["title"], "Build the thing");
    assert_eq!(first["assignee"], "ai");
    assert_eq!(first["isDraft"], false);
    assert_eq!(first["attachments"].as_array().unwrap().len(), 2);
    assert!(first["description"].as_str().unwrap().contains("元の依頼"));
    assert_eq!(task_count(&server, &pid), before + 1);

    let second = task(
        &send_images(&server, &pid, "Build the thing\nDetails", None, images),
        201,
    );
    assert_ne!(second["id"], first["id"]);
    assert_eq!(task_count(&server, &pid), before + 2);
}

#[test]
fn a_legacy_task_parse_problem_does_not_block_simple_request_creation() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let legacy_task = home
        .path()
        .join("shared")
        .join("projects")
        .join(&pid)
        .join("tasks/1/task.json");
    let mut metadata: Value = serde_json::from_slice(&fs::read(&legacy_task).unwrap()).unwrap();
    metadata["cardStatus"] = json!("doing");
    fs::write(&legacy_task, serde_json::to_vec_pretty(&metadata).unwrap()).unwrap();

    let server = Running::start(home.path());
    let created = task(&send(&server, &pid, "A new request", None, false), 201);
    assert_eq!(created["id"], 2);

    let board = server.get(&format!("/api/projects/{pid}/board"));
    assert_eq!(board.status, 200, "{}", board.body);
    let board: Value = serde_json::from_str(&board.body).unwrap();
    assert!(board["problems"].as_array().unwrap().iter().any(|problem| {
        problem["file"]
            .as_str()
            .is_some_and(|file| file.ends_with("tasks/1/task.json"))
    }));
}

#[test]
fn an_invalid_image_is_rejected_without_publishing_and_a_valid_retry_can_recover() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let invalid = send_images(
        &server,
        &pid,
        "Request",
        None,
        vec![b"not an image".to_vec()],
    );
    assert_eq!(invalid.status, 422, "{}", invalid.body);
    assert_eq!(task_count(&server, &pid), before);

    let recovered = task(&send(&server, &pid, "Request", None, true), 201);
    assert_eq!(recovered["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn an_oversized_image_is_rejected_without_publishing_a_task() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);
    let too_large = vec![0; agent_board::domain::MAX_ATTACHMENT_BYTES + 1];

    let reply = send_images(&server, &pid, "Request", None, vec![too_large]);
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(task_count(&server, &pid), before);
}

#[test]
fn a_staging_creation_failure_publishes_no_task_and_a_retry_can_recover() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let project_dir = home.path().join("shared/projects").join(&pid);
    let staging_root = project_dir.join(".internal/request-staging");
    fs::write(&staging_root, b"block directory creation").unwrap();
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);

    let failed = send_images(
        &server,
        &pid,
        "Recoverable request",
        None,
        vec![png(), png()],
    );
    assert_eq!(failed.status, 500, "{}", failed.body);
    assert_eq!(task_count(&server, &pid), before);

    fs::remove_file(&staging_root).unwrap();
    let recovered = task(
        &send_images(
            &server,
            &pid,
            "Recoverable request",
            None,
            vec![png(), png()],
        ),
        201,
    );
    assert_eq!(recovered["attachments"].as_array().unwrap().len(), 2);
    assert_eq!(task_count(&server, &pid), before + 1);
}

#[test]
fn repeated_simple_request_content_creates_distinct_tasks() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = task_count(&server, &pid);
    let first = task(&send(&server, &pid, "First", None, false), 201);

    let second = task(&send(&server, &pid, "First", None, false), 201);
    assert_ne!(second["id"], first["id"]);
    assert_eq!(task_count(&server, &pid), before + 2);
}

#[test]
fn simultaneous_simple_requests_create_distinct_tasks() {
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
    assert_eq!(first.status, 201, "{}", first.body);
    assert_eq!(second.status, 201, "{}", second.body);
    let first_task = serde_json::from_str::<Value>(&first.body).unwrap()["task"]["id"].clone();
    let second_task = serde_json::from_str::<Value>(&second.body).unwrap()["task"]["id"].clone();
    assert_ne!(first_task, second_task);
    assert_eq!(task_count(&server, &pid), before + 2);
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
