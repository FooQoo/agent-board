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
            "kinds": {"results": true, "questions": false, "history": false, "summary": true},
            "summary": {"intervalMinutes": 60},
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
    // The removed periodic and state-change groups are accepted from older pages, ignored, and never returned.
    assert!(saved.json().get("periodic").is_none());
    assert!(saved.json().get("stateChanges").is_none());
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
fn a_saved_file_without_the_summary_fields_reads_with_their_defaults_and_is_not_rewritten() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let file = home
        .path()
        .join(".internal")
        .join("notification-settings.json");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    let old = r#"{"formatVersion":1,"revision":7,"kinds":{"results":false,"questions":true,"history":false}}"#;
    std::fs::write(&file, old).unwrap();
    let server = Running::start(home.path());
    assert_eq!(
        server.get("/api/notification-settings").json(),
        json!({
            "kinds": {"results": false, "questions": true, "history": false, "summary": true},
            "summary": {"intervalMinutes": 60},
            "revision": 7
        })
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old);
    server.stop();
}

#[test]
fn the_summary_interval_is_saved_alone_and_only_from_the_allowed_values() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    for minutes in [0, 30, 60, 120, 240] {
        let saved = put(&server, &json!({"summary": {"intervalMinutes": minutes}}));
        assert_eq!(saved.status, 200, "{}", saved.body);
        assert_eq!(saved.json()["summary"]["intervalMinutes"], minutes);
        assert_eq!(saved.json()["kinds"]["summary"], true);
    }
    let revision = server.get("/api/notification-settings").json()["revision"].clone();
    for body in [
        json!({"summary": {"intervalMinutes": 45}}),
        json!({"summary": {}}),
        json!({"summary": {"intervalMinutes": 60, "extra": 1}}),
    ] {
        let reply = put(&server, &body);
        assert_eq!(reply.status, 422, "{}", reply.body);
    }
    assert_eq!(
        server.get("/api/notification-settings").json()["revision"],
        revision
    );
    // The kind switches on its own and leaves the interval as it was.
    let kinds = put(
        &server,
        &json!({"kinds": {"results": true, "questions": false, "history": false, "summary": false}}),
    );
    assert_eq!(kinds.status, 200, "{}", kinds.body);
    assert_eq!(kinds.json()["kinds"]["summary"], false);
    assert_eq!(kinds.json()["summary"]["intervalMinutes"], 240);
    server.stop();
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
        json!({"stateChanges": {"started": true, "pending": true, "done": true}}),
        json!({"periodic": {"enabled": true, "intervalMinutes": 60}}),
    ] {
        let reply = put(&server, &body);
        assert_eq!(reply.status, 422, "{}", reply.body);
        assert_eq!(
            reply.json()["error"]["code"],
            "invalid_notification_settings"
        );
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
    let body =
        json!({"stateChanges": {"started": false, "pending": true, "done": true}}).to_string();
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
        server.get("/api/notification-settings").json()["revision"],
        0
    );
    server.stop();
}
