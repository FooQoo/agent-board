//! The HTTP surface of epics, epic membership, and decision answers (AC-2 and
//! AC-5 on the API side, U6-4, U6-7, U6-9). Servers listen on port 0 in a
//! temporary data area, and the projects are made with the real CLI.

mod common;

use std::path::Path;

use common::{Running, agboard, demo_project, json_ok};
use serde_json::{Value, json};

/// The ID of the project named "Demo".
fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// The protections every write needs, sent with a wrong origin, or none.
fn foreign(server: &Running) -> Vec<(String, String)> {
    let token = server.token();
    vec![
        ("Origin".into(), "http://evil.example".into()),
        ("Sec-Fetch-Site".into(), "cross-site".into()),
        ("X-Skan-Token".into(), token),
    ]
}

#[test]
fn the_write_protections_apply_to_the_new_routes() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());

    for (method, path, body) in [
        (
            "POST",
            format!("/api/projects/{pid}/epics"),
            Some(r#"{"id":"A-1","name":"A"}"#),
        ),
        (
            "PATCH",
            format!("/api/projects/{pid}/epics/A-1"),
            Some(r#"{"name":"B"}"#),
        ),
        (
            "PUT",
            format!("/api/projects/{pid}/cards/1/epic"),
            Some(r#"{"epicId":null}"#),
        ),
    ] {
        let reply = server.request(
            method,
            &path,
            body,
            &foreign(&server),
            Some("application/json"),
        );
        assert_eq!(reply.status, 403, "{method} {path}");
        assert_eq!(reply.code(), "forbidden");
        let no_token = server.request(method, &path, body, &[], Some("application/json"));
        assert_eq!(no_token.status, 403, "{method} {path} without the token");
    }
    let listed = server.get(&format!("/api/projects/{pid}/epics"));
    assert_eq!(listed.status, 200);
    assert_eq!(
        listed.json()["epics"],
        json!([]),
        "a refused write changes nothing"
    );
    server.stop();
}

#[test]
fn an_epic_is_created_listed_read_and_changed_over_http() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let epics = format!("/api/projects/{pid}/epics");

    let created = server.write(
        "POST",
        &epics,
        Some(r#"{"id":"file-share","name":"File share"}"#),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let epic = &created.json()["epic"];
    assert_eq!(epic["id"], "FILE-SHARE");
    assert_eq!(epic["name"], "File share");
    let color = epic["color"].as_str().unwrap();
    assert!(
        color.starts_with('#') && color.len() == 7,
        "a color is chosen when none is given: {color}"
    );
    assert!(epic["plan"].as_str().unwrap().contains("## 進め方"));

    let listed = server.get(&epics);
    assert_eq!(listed.json()["epics"][0]["id"], "FILE-SHARE");
    let one = server.get(&format!("{epics}/FILE-SHARE"));
    assert_eq!(one.status, 200);
    assert_eq!(one.json()["epic"]["name"], "File share");

    let patched = server.write(
        "PATCH",
        &format!("{epics}/FILE-SHARE"),
        Some(r##"{"name":"Shared files","color":"#22AA33"}"##),
    );
    assert_eq!(patched.status, 200, "{}", patched.body);
    assert_eq!(patched.json()["changed"], true);
    assert_eq!(patched.json()["epic"]["name"], "Shared files");
    assert_eq!(patched.json()["epic"]["color"], "#22AA33");

    let bad_color = server.write(
        "PATCH",
        &format!("{epics}/FILE-SHARE"),
        Some(r#"{"color":"red"}"#),
    );
    assert_eq!(bad_color.status, 422);
    assert_eq!(bad_color.code(), "invalid_value");

    let taken = server.write(
        "POST",
        &epics,
        Some(r#"{"id":"FILE-SHARE","name":"Again"}"#),
    );
    assert_eq!(taken.status, 409);
    assert_eq!(taken.code(), "epic_id_taken");

    let missing = server.get(&format!("{epics}/NOPE-1"));
    assert_eq!(missing.status, 404);
    assert_eq!(missing.code(), "epic_not_found");
    let malformed = server.get(&format!("{epics}/no%20good"));
    assert_eq!(malformed.status, 422);
    server.stop();
}

#[test]
fn a_card_takes_and_leaves_an_epic_over_http_and_a_person_may_change_an_archived_card() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            "FILE-SHARE",
            "--name",
            "File share",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let path = format!("/api/projects/{pid}/cards/1/epic");

    let set = server.write("PUT", &path, Some(r#"{"epicId":"FILE-SHARE"}"#));
    assert_eq!(set.status, 200, "{}", set.body);
    assert_eq!(set.json()["card"]["epicId"], "FILE-SHARE");
    assert_eq!(set.json()["card"]["epic"]["name"], "File share");

    let unknown = server.write("PUT", &path, Some(r#"{"epicId":"NOPE-1"}"#));
    assert_eq!(unknown.status, 404);
    assert_eq!(unknown.code(), "epic_not_found");

    let missing_field = server.write("PUT", &path, Some(r#"{}"#));
    assert_eq!(missing_field.status, 422, "epicId is required");

    let cleared = server.write("PUT", &path, Some(r#"{"epicId":null}"#));
    assert_eq!(cleared.status, 200);
    assert_eq!(cleared.json()["card"]["epicId"], Value::Null);

    // A card that is archived takes no AI change, but a person may change it.
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            "1",
            "done",
            "--actor",
            "ai",
            "--reason",
            "Done.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let archived = server.write(
        "POST",
        &format!("/api/projects/{pid}/cards/1/archive"),
        None,
    );
    assert_eq!(archived.status, 200, "{}", archived.body);
    let person = server.write("PUT", &path, Some(r#"{"epicId":"FILE-SHARE"}"#));
    assert_eq!(person.status, 200, "{}", person.body);
    assert_eq!(person.json()["card"]["epicId"], "FILE-SHARE");
    server.stop();
}

#[test]
fn an_answer_names_a_choice_or_a_note_and_an_unknown_choice_is_422() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request_file = home.path().join("request.json");
    std::fs::write(
        &request_file,
        json!({"question": "Which plan?", "choices": [{"id": "proceed", "label": "Proceed"}]})
            .to_string(),
    )
    .unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-file",
            request_file.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let shown = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let request = shown["card"]["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string();
    let path = format!("/api/projects/{pid}/cards/1/answer");

    let unknown = server.write(
        "POST",
        &path,
        Some(&json!({"requestId": request, "choiceId": "nope"}).to_string()),
    );
    assert_eq!(unknown.status, 422);
    assert_eq!(unknown.code(), "request_choice_unknown");

    let empty = server.write(
        "POST",
        &path,
        Some(&json!({"requestId": request}).to_string()),
    );
    assert_eq!(empty.status, 422, "{}", empty.body);

    let stale = server.write(
        "POST",
        &path,
        Some(&json!({"requestId": "0".repeat(32), "choiceId": "proceed"}).to_string()),
    );
    assert_eq!(stale.status, 409);
    assert_eq!(stale.code(), "request_changed");

    let answered = server.write(
        "POST",
        &path,
        Some(&json!({"requestId": request, "choiceId": "proceed", "text": "Go."}).to_string()),
    );
    assert_eq!(answered.status, 200, "{}", answered.body);
    assert_eq!(answered.json()["card"]["agentStatus"], "idle");
    let last = answered.json()["card"]["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["choiceId"], "proceed");
    assert_eq!(last["reason"], "Go.");
    server.stop();
}
