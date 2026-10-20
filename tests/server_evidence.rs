//! The HTTP surface of task and epic images, including rejection of the retired
//! task text-evidence routes. Servers listen on port 0.

mod common;

use std::path::Path;

use agent_board::domain::ProjectId;
use agent_board::file_store::FileStore;
use common::{Running, agboard, demo_project, json_error, json_ok, multipart, png};
use serde_json::{Value, json};

const BOUNDARY: &str = "agboard-test-boundary";
const IMAGE_ID: &str = "0123456789abcdef0123456789abcdef";

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A task-image registration: one PNG as the `file` part, its metadata as `metadata`.
fn image_body(id: &str) -> Vec<u8> {
    let metadata = json!({
        "requestId": "11111111111111111111111111111111",
        "attachments": [{"id": id, "name": "shot.png"}]
    })
    .to_string();
    multipart(
        BOUNDARY,
        &[("metadata", &metadata)],
        &[("file", "shot.png", &png())],
    )
}

fn add_second_task(home: &Path) {
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "add",
            "Second task",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
}

#[test]
fn a_task_image_is_served_only_to_its_own_task_with_its_media_type() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_second_task(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let added = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/1/attachments"),
        image_body(IMAGE_ID),
        BOUNDARY,
    );
    assert_eq!(added.status, 201, "{}", added.body);
    assert_eq!(added.json()["task"]["attachments"][0]["id"], IMAGE_ID);

    let served = server.get(&format!(
        "/api/projects/{pid}/tasks/1/attachments/{IMAGE_ID}"
    ));
    assert_eq!(served.status, 200);
    assert_eq!(served.header("content-type"), Some("image/png"));
    assert_eq!(served.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(served.bytes, png());

    let other_task = server.get(&format!(
        "/api/projects/{pid}/tasks/2/attachments/{IMAGE_ID}"
    ));
    assert_eq!(other_task.status, 404);
    assert_eq!(other_task.code(), "attachment_not_found");

    let malformed = server.get(&format!(
        "/api/projects/{pid}/tasks/1/attachments/not-an-id"
    ));
    assert_eq!(malformed.status, 404);

    let deleted = server.write(
        "DELETE",
        &format!("/api/projects/{pid}/tasks/1/attachments/{IMAGE_ID}"),
        None,
    );
    assert_eq!(deleted.status, 200, "{}", deleted.body);
    assert_eq!(deleted.json()["task"]["attachments"], json!([]));
    let gone = server.get(&format!(
        "/api/projects/{pid}/tasks/1/attachments/{IMAGE_ID}"
    ));
    assert_eq!(gone.status, 404);
    server.stop();
}

#[test]
fn an_epic_image_is_served_only_through_its_own_epic() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    add_second_task(home.path());
    for id in ["FILE-SHARE", "OTHER"] {
        let (code, _, err) = agboard(
            home.path(),
            &[
                "--project",
                "Demo",
                "epic",
                "add",
                id,
                "--name",
                "Epic",
                "--actor",
                "ai",
            ],
        );
        assert_eq!(code, 0, "{err}");
    }
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let added = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/epics/FILE-SHARE/attachments"),
        image_body(IMAGE_ID),
        BOUNDARY,
    );
    assert_eq!(added.status, 201, "{}", added.body);
    assert_eq!(added.json()["epic"]["attachments"][0]["id"], IMAGE_ID);

    let listed = server.get(&format!("/api/projects/{pid}/epics/FILE-SHARE/attachments"));
    assert_eq!(listed.json()["attachments"][0]["id"], IMAGE_ID);
    let served = server.get(&format!(
        "/api/projects/{pid}/epics/FILE-SHARE/attachments/{IMAGE_ID}"
    ));
    assert_eq!(served.status, 200);
    assert_eq!(served.bytes, png());

    let other_epic = server.get(&format!(
        "/api/projects/{pid}/epics/OTHER/attachments/{IMAGE_ID}"
    ));
    assert_eq!(other_epic.status, 404);
    let by_task = server.get(&format!(
        "/api/projects/{pid}/tasks/1/attachments/{IMAGE_ID}"
    ));
    assert_eq!(by_task.status, 404);
    let unknown_epic = server.get(&format!(
        "/api/projects/{pid}/epics/NOPE-1/attachments/{IMAGE_ID}"
    ));
    assert_eq!(unknown_epic.status, 404);
    assert_eq!(unknown_epic.code(), "epic_not_found");

    let deleted = server.write(
        "DELETE",
        &format!("/api/projects/{pid}/epics/FILE-SHARE/attachments/{IMAGE_ID}"),
        None,
    );
    assert_eq!(deleted.status, 200, "{}", deleted.body);
    assert_eq!(
        server
            .get(&format!(
                "/api/projects/{pid}/epics/FILE-SHARE/attachments/{IMAGE_ID}"
            ))
            .status,
        404
    );
    server.stop();
}

#[test]
fn a_person_may_add_images_to_a_draft_but_the_cli_may_not() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let store = FileStore::open(&home.path().join("shared"));
    store
        .set_draft(
            &pid.parse::<ProjectId>().unwrap(),
            1,
            true,
            chrono::Utc::now(),
        )
        .unwrap();
    let server = Running::start(home.path());

    let image = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/1/attachments"),
        image_body(IMAGE_ID),
        BOUNDARY,
    );
    assert_eq!(
        image.status, 201,
        "a person may add an image to a draft: {}",
        image.body
    );
    server.stop();

    let shot = home.path().join("shot.png");
    std::fs::write(&shot, png()).unwrap();
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "attachment",
            "add",
            "1",
            "--file",
            shot.to_str().unwrap(),
            "--actor",
            "ai",
        ],
    );
    assert_eq!(
        (code, code_name.as_str()),
        (1, "task_is_draft"),
        "the CLI refuses drafts"
    );
}

#[test]
fn task_text_evidence_routes_are_removed() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let add = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/1/evidence"),
        multipart(BOUNDARY, &[], &[("file", "run.log", b"removed")]),
        BOUNDARY,
    );
    assert_eq!(add.status, 404);
    assert_eq!(
        server
            .get(&format!(
                "/api/projects/{pid}/tasks/1/evidence/{}",
                "a".repeat(32)
            ))
            .status,
        404
    );
    let board = server.get(&format!("/api/projects/{pid}/board"));
    assert!(board.json().to_string().find("evidence").is_none());
    server.stop();
}

#[test]
fn an_image_of_another_project_is_not_found_even_with_the_same_task_number() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard(home.path(), &["project", "create", "Other"]);
    assert_eq!(code, 0, "{err}");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Other",
            "add",
            "Same number",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let other_pid = json_ok(home.path(), &["project", "ls", "--json"])["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "Other")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(pid, other_pid);
    let server = Running::start(home.path());

    let added = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/1/attachments"),
        image_body(IMAGE_ID),
        BOUNDARY,
    );
    assert_eq!(added.status, 201, "{}", added.body);
    let served = server.get(&format!(
        "/api/projects/{other_pid}/tasks/1/attachments/{IMAGE_ID}"
    ));
    assert_eq!(served.status, 404);
    assert_eq!(served.code(), "attachment_not_found");
    server.stop();
}

#[test]
fn an_image_registration_with_a_bad_metadata_part_is_refused_and_nothing_is_written() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let body = multipart(
        BOUNDARY,
        &[("metadata", "{not json")],
        &[("file", "shot.png", &png())],
    );
    let reply = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/tasks/1/attachments"),
        body,
        BOUNDARY,
    );
    assert_eq!(reply.status, 422);
    let task = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(task["task"]["attachments"], Value::Array(vec![]));
    server.stop();
}
