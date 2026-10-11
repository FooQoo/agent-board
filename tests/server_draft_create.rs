//! The draft flag at card creation over HTTP: a person can add a card as a draft in the same
//! request (JSON and multipart), the agent of a new draft is idle, and the default stays a
//! normal card. Servers listen on port 0.

mod common;

use std::path::Path;

use common::{Reply, Running, demo_project, multipart, png};
use serde_json::{Value, json};

const BOUNDARY: &str = "agboard-create-boundary";
const IMAGE_ID: &str = "0123456789abcdef0123456789abcdef";

fn project_id(home: &Path) -> String {
    common::json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn post_card(server: &Running, pid: &str, body: &str) -> Reply {
    server.write("POST", &format!("/api/projects/{pid}/cards"), Some(body))
}

fn created(reply: &Reply) -> Value {
    assert_eq!(reply.status, 201, "{}", reply.body);
    serde_json::from_str::<Value>(&reply.body).unwrap()["card"].clone()
}

fn board_cards(server: &Running, pid: &str) -> Vec<Value> {
    let reply = server.get(&format!("/api/projects/{pid}/board"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    serde_json::from_str::<Value>(&reply.body).unwrap()["cards"]
        .as_array()
        .unwrap()
        .clone()
}

fn card_in_board(server: &Running, pid: &str, id: i64) -> Value {
    board_cards(server, pid)
        .into_iter()
        .find(|card| card["id"] == id)
        .expect("the created card is on the board")
}

#[test]
fn a_card_added_as_a_draft_is_a_draft_with_an_idle_agent() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let card = created(&post_card(
        &server,
        &pid,
        r#"{"title":"Draft work","description":"","assignee":"ai","isDraft":true}"#,
    ));
    assert_eq!(card["isDraft"], true);
    assert_eq!(card["agentStatus"], "idle");
    assert_eq!(card["cardStatus"], "todo");
    let id = card["id"].as_i64().unwrap();
    assert_eq!(card_in_board(&server, &pid, id)["isDraft"], true);
}

#[test]
fn a_card_added_without_the_flag_or_with_false_is_a_normal_card() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    let absent = created(&post_card(
        &server,
        &pid,
        r#"{"title":"Plain","description":"","assignee":"ai"}"#,
    ));
    let explicit = created(&post_card(
        &server,
        &pid,
        r#"{"title":"Explicit","description":"","assignee":"human","isDraft":false}"#,
    ));
    assert_eq!(absent["isDraft"], false);
    assert_eq!(explicit["isDraft"], false);
}

#[test]
fn the_draft_flag_must_be_a_boolean_and_nothing_is_added_when_it_is_not() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let before = board_cards(&server, &pid).len();

    let reply = post_card(
        &server,
        &pid,
        r#"{"title":"Bad flag","description":"","assignee":"ai","isDraft":"yes"}"#,
    );
    assert_ne!(reply.status, 201, "{}", reply.body);
    assert_eq!(board_cards(&server, &pid).len(), before);
}

/// The multipart metadata for a new card with one image, optionally as a draft.
fn card_with_image_metadata(draft: Option<bool>) -> String {
    let mut metadata = json!({
        "requestId": "22222222222222222222222222222222",
        "title": "Card with image",
        "description": "",
        "assignee": "human",
        "attachments": [{"id": IMAGE_ID, "name": "shot.png"}]
    });
    if let Some(draft) = draft {
        metadata["isDraft"] = json!(draft);
    }
    metadata.to_string()
}

#[test]
fn a_card_with_an_image_can_be_added_as_a_draft_in_one_request() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let metadata = card_with_image_metadata(Some(true));
    let body = multipart(
        BOUNDARY,
        &[("metadata", &metadata)],
        &[("file", "shot.png", &png())],
    );

    let reply = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/cards/multipart"),
        body,
        BOUNDARY,
    );
    let card = created(&reply);
    assert_eq!(card["isDraft"], true);
    assert_eq!(card["agentStatus"], "idle");
    assert_eq!(card["attachments"].as_array().unwrap().len(), 1);
    let id = card["id"].as_i64().unwrap();
    assert_eq!(card_in_board(&server, &pid, id)["isDraft"], true);
}

#[test]
fn a_card_with_an_image_is_a_normal_card_without_the_flag() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let metadata = card_with_image_metadata(None);
    let body = multipart(
        BOUNDARY,
        &[("metadata", &metadata)],
        &[("file", "shot.png", &png())],
    );

    let reply = server.write_multipart(
        "POST",
        &format!("/api/projects/{pid}/cards/multipart"),
        body,
        BOUNDARY,
    );
    let card = created(&reply);
    assert_eq!(card["isDraft"], false);
}

#[test]
fn an_edit_refuses_the_draft_flag_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let card = created(&post_card(
        &server,
        &pid,
        r#"{"title":"Editable","description":"","assignee":"ai"}"#,
    ));
    let id = card["id"].as_i64().unwrap();
    let metadata = json!({
        "requestId": "33333333333333333333333333333333",
        "title": "Changed",
        "isDraft": true
    })
    .to_string();
    let body = multipart(BOUNDARY, &[("metadata", &metadata)], &[]);

    let reply = server.write_multipart(
        "PATCH",
        &format!("/api/projects/{pid}/cards/{id}/multipart"),
        body,
        BOUNDARY,
    );
    assert_eq!(reply.status, 422, "{}", reply.body);
    let after = card_in_board(&server, &pid, id);
    assert_eq!(after["title"], "Editable");
    assert_eq!(after["isDraft"], false);
}
