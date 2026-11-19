//! `GET`/`PUT /api/notification-settings` over HTTP: the defaults, a save kept across a restart,
//! the write guard, and what an invalid body leaves unchanged.

mod common;

use common::{Running, demo_project};
use serde_json::json;

fn put(server: &Running, body: &serde_json::Value) -> common::Reply {
    server.write("PUT", "/api/notification-settings", Some(&body.to_string()))
}

#[test]
fn nothing_saved_reads_as_the_defaults() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let reply = server.get("/api/notification-settings");
    assert_eq!(reply.status, 200);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert_eq!(
        reply.json(),
        json!({
            "kinds": {"results": true, "questions": true, "stateChanges": false, "history": false},
            "stateChanges": {"started": true, "pending": true, "done": true},
            "periodic": {"enabled": false, "intervalMinutes": 60},
            "revision": 0
        })
    );
    server.stop();
}

#[test]
fn a_save_is_read_back_and_kept_across_a_restart() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let saved = put(
        &server,
        &json!({
            "kinds": {"results": false, "questions": true, "stateChanges": true, "history": false},
            "stateChanges": {"started": false, "pending": true, "done": true},
            "periodic": {"enabled": true, "intervalMinutes": 120}
        }),
    );
    assert_eq!(saved.status, 200, "{}", saved.body);
    assert_eq!(
        server.get("/api/notification-settings").json(),
        saved.json()
    );
    server.stop();

    let restarted = Running::start(home.path());
    assert_eq!(
        restarted.get("/api/notification-settings").json(),
        saved.json()
    );
    restarted.stop();
}

#[test]
fn an_invalid_body_is_refused_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    for body in [
        json!({}),
        json!({"extra": true}),
        json!({"kinds": {"results": true}}),
        json!({"periodic": {"enabled": true, "intervalMinutes": 45}}),
    ] {
        let reply = put(&server, &body);
        assert_eq!(reply.status, 422, "{}", reply.body);
        assert_eq!(reply.json()["code"], "invalid_notification_settings");
    }
    assert_eq!(
        server.get("/api/notification-settings").json()["revision"],
        0
    );
    server.stop();
}

#[test]
fn a_write_without_the_page_token_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let body = json!({"periodic": {"enabled": true, "intervalMinutes": 30}}).to_string();
    let no_token = server.request(
        "PUT",
        "/api/notification-settings",
        Some(&body),
        &[
            (
                "Origin".into(),
                format!("http://127.0.0.1:{}", server.port()),
            ),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
        ],
        Some("application/json"),
    );
    assert_eq!(no_token.status, 403, "{}", no_token.body);
    assert_eq!(
        server.get("/api/notification-settings").json()["periodic"]["enabled"],
        false
    );
    server.stop();
}
