//! The HTTP surface of messages: reading, answering, sending a request with images, and
//! withdrawing a request.

mod common;

use std::path::Path;

use common::{Running, agboard, demo_project, json_ok, multipart};
use serde_json::{Value, json};

/// A 1x1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0xf8, 0x5f,
    0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb, 0x47, 0xba, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn project_id(home: &Path) -> String {
    json_ok(home, &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn ask(home: &Path) {
    let json = common::decision_json("Which plan?");
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            &json,
            "--no-wait",
        ],
    );
    assert_eq!(code, 0, "{err}");
}

#[test]
fn messages_are_read_listed_and_answered_over_http() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let base = format!("/api/projects/{pid}/messages");

    let one = server.get(&format!("{base}/Q-1"));
    assert_eq!(one.status, 200, "{}", one.body);
    let question = &one.json()["question"];
    assert_eq!(question["body"], "Which plan?");
    assert_eq!(question["type"], "question");
    assert_eq!(question["status"], "open");
    assert_eq!(question["referencedBy"], json!([1]));
    assert!(question.get("kind").is_none() && question.get("requestId").is_none());

    assert_eq!(server.get(&format!("{base}/Q-99")).status, 404);
    let listed = server.get(&base).json();
    assert_eq!(listed["messages"][0]["id"], "Q-1");
    assert_eq!(server.get(&format!("{base}?status=bogus")).status, 422);
    assert_eq!(
        server.get(&format!("{base}?type=request")).json()["messages"],
        json!([])
    );

    // The summary lists the open question without a kind or a request.
    let summary = server.get(&format!("/api/projects/{pid}/summary")).json();
    assert_eq!(summary["questions"][0]["id"], "Q-1");
    assert!(summary["questions"][0].get("kind").is_none());

    let body = json!({"answers": [{"questionId": "Q-1", "choiceId": "a"}]}).to_string();
    let answered = server.write("POST", &format!("{base}/answers"), Some(&body));
    assert_eq!(answered.status, 200, "{}", answered.body);
    assert_eq!(answered.json()["questions"][0]["reply"]["via"], "ui");
    let again = server.write("POST", &format!("{base}/answers"), Some(&body));
    assert_eq!(again.status, 409);
    assert_eq!(again.code(), "question_answered");
    assert_eq!(again.json()["questionAnswered"], json!(["Q-1"]));
    server.stop();
}

#[test]
fn a_request_is_sent_with_images_and_withdrawn_by_a_person() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let base = format!("/api/projects/{pid}/messages");

    let boundary = "----agboard";
    let text = "Add a reset link.\n\n![](attachments/login.png)";
    let body = multipart(boundary, &[("text", text)], &[("images", "login.png", PNG)]);
    let sent = server.write_multipart("POST", &format!("{base}/requests"), body, boundary);
    assert_eq!(sent.status, 201, "{}", sent.body);
    let request = &sent.json()["request"];
    assert_eq!(request["id"], "Q-2");
    assert_eq!(request["status"], "open");
    assert_eq!(request["body"], text);
    let shared = home.path().join("shared/projects").join(&pid);
    assert_eq!(
        std::fs::read(shared.join("qa/Q-2/attachments/login.png")).unwrap(),
        PNG
    );

    let shown = server.get(&format!("{base}/Q-2")).json();
    assert_eq!(shown["request"]["from"], "human");
    let listed = server.get(&format!("{base}?type=request")).json();
    assert_eq!(listed["messages"].as_array().unwrap().len(), 1);

    let bad = multipart(boundary, &[("note", "x")], &[]);
    let refused = server.write_multipart("POST", &format!("{base}/requests"), bad, boundary);
    assert_eq!(refused.status, 422, "{}", refused.body);
    let empty = multipart(boundary, &[("text", "   ")], &[]);
    let refused = server.write_multipart("POST", &format!("{base}/requests"), empty, boundary);
    assert_eq!(refused.status, 422, "{}", refused.body);

    // A person withdraws a request, never a question.
    let refused = server.write("POST", &format!("{base}/Q-1/withdraw"), None);
    assert_eq!(refused.status, 403, "{}", refused.body);
    assert_eq!(refused.code(), "ai_only");
    let withdrawn = server.write("POST", &format!("{base}/Q-2/withdraw"), None);
    assert_eq!(withdrawn.status, 200, "{}", withdrawn.body);
    assert_eq!(withdrawn.json()["request"]["status"], "withdrawn");
    let again = server.write("POST", &format!("{base}/Q-2/withdraw"), None);
    assert_eq!(again.status, 200);
    let gone: Value = server.get(&format!("{base}/Q-2")).json();
    assert!(gone["request"]["withdrawnAt"].is_string());

    // The old routes are gone.
    assert_eq!(server.get(&format!("/api/projects/{pid}/qa")).status, 404);
    server.stop();
}

#[test]
fn an_answer_that_repeats_a_question_is_refused_before_anything_is_saved() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());
    let pid = project_id(home.path());
    let server = Running::start(home.path());
    let base = format!("/api/projects/{pid}/messages");

    let boundary = "----agboard";
    let metadata = json!({"answers": [
        {"questionId": "Q-1", "choiceId": "a"},
        {"questionId": "Q-1", "choiceId": "b"},
    ]})
    .to_string();
    let body = multipart(
        boundary,
        &[("metadata", &metadata)],
        &[("images.Q-1", "shot.png", PNG)],
    );
    let refused =
        server.write_multipart("POST", &format!("{base}/answers/multipart"), body, boundary);
    assert_eq!(refused.status, 422, "{}", refused.body);
    assert_eq!(refused.code(), "invalid_value");
    assert!(
        refused.body.contains("Q-1 is answered twice."),
        "{}",
        refused.body
    );
    assert_eq!(
        server.get(&format!("{base}/Q-1")).json()["question"]["status"],
        "open"
    );

    // One answer with its image still goes through.
    let metadata = json!({"answers": [{"questionId": "Q-1", "choiceId": "a"}]}).to_string();
    let body = multipart(
        boundary,
        &[("metadata", &metadata)],
        &[("images.Q-1", "shot.png", PNG)],
    );
    let sent = server.write_multipart("POST", &format!("{base}/answers/multipart"), body, boundary);
    assert_eq!(sent.status, 200, "{}", sent.body);
    assert_eq!(
        sent.json()["questions"][0]["reply"]["images"],
        json!(["shot.png"])
    );
    server.stop();
}
