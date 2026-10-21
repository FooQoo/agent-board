//! `GET`/`PUT /api/preferences` and the `preferences` event over HTTP: the
//! saved language and theme, the write guard, and what a save announces.

mod common;

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

use common::{Running, demo_project};
use serde_json::json;

fn saved_preferences(server: &Running) -> serde_json::Value {
    let reply = server.get("/api/preferences");
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.json()
}

fn put(server: &Running, body: &serde_json::Value) -> common::Reply {
    server.write("PUT", "/api/preferences", Some(&body.to_string()))
}

#[test]
fn nothing_saved_reads_as_english_light_blue_at_revision_zero() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let reply = server.get("/api/preferences");
    assert_eq!(reply.status, 200);
    assert_eq!(reply.header("cache-control"), Some("no-store"));
    assert_eq!(
        reply.json(),
        json!({"locale": "en", "theme": {"mode": "light", "accent": "blue"}, "revision": 0})
    );
    server.stop();
}

#[test]
fn a_save_is_read_back_and_kept_across_a_restart() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let body = json!({"locale": "ja", "theme": {"mode": "dark", "accent": "teal"}});
    let saved = put(&server, &body);
    assert_eq!(saved.status, 200, "{}", saved.body);
    assert_eq!(
        saved.json(),
        json!({"locale": "ja", "theme": {"mode": "dark", "accent": "teal"}, "revision": 1})
    );
    assert_eq!(saved_preferences(&server), saved.json());
    server.stop();

    let restarted = Running::start(home.path());
    assert_eq!(saved_preferences(&restarted), saved.json());
    restarted.stop();
}

#[test]
fn a_partial_save_keeps_the_field_that_was_not_sent() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    put(&server, &json!({"locale": "ja"}));
    let reply = put(
        &server,
        &json!({"theme": {"mode": "dark", "accent": "gray"}}),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["locale"], "ja");
    assert_eq!(reply.json()["revision"], 2);
    server.stop();
}

#[test]
fn a_write_without_the_page_token_is_refused_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let body = json!({"locale": "ja"}).to_string();
    let no_token = server.request(
        "PUT",
        "/api/preferences",
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
    assert_eq!(saved_preferences(&server)["locale"], "en");
    server.stop();
}

#[test]
fn a_write_from_another_origin_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let token = server.token();
    let body = json!({"locale": "ja"}).to_string();
    let foreign = server.request(
        "PUT",
        "/api/preferences",
        Some(&body),
        &[
            ("Origin".into(), "http://evil.example".into()),
            ("Sec-Fetch-Site".into(), "cross-site".into()),
            ("X-Agboard-Token".into(), token),
        ],
        Some("application/json"),
    );
    assert_eq!(foreign.status, 403, "{}", foreign.body);
    assert_eq!(saved_preferences(&server)["locale"], "en");
    server.stop();
}

#[test]
fn an_unknown_field_or_an_invalid_value_is_refused_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    put(&server, &json!({"locale": "ja"}));
    let before = saved_preferences(&server);
    for body in [
        json!({"locale": "ja", "extra": 1}),
        json!({"locale": "fr"}),
        json!({"theme": {"mode": "neon", "accent": "blue"}}),
        json!({"theme": {"mode": "light", "accent": "magenta"}}),
        json!({}),
    ] {
        let reply = put(&server, &body);
        assert_eq!(reply.status, 422, "{body}: {}", reply.body);
        assert_eq!(reply.code(), "invalid_preferences", "{body}");
    }
    assert_eq!(saved_preferences(&server), before);
    server.stop();
}

#[test]
fn a_save_sends_preferences_to_open_event_streams_and_never_changed() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let mut stream = TcpStream::connect(("127.0.0.1", server.port())).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    write!(
        stream,
        "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n",
        server.port()
    )
    .unwrap();
    let mut lines = BufReader::new(stream);
    let mut seen = String::new();
    loop {
        let mut line = String::new();
        lines.read_line(&mut line).unwrap();
        seen.push_str(&line);
        if seen.contains("event: ready") {
            break;
        }
    }

    let reply = put(&server, &json!({"locale": "ja"}));
    assert_eq!(reply.status, 200, "{}", reply.body);

    let mut found = String::new();
    loop {
        let mut line = String::new();
        let read = lines.read_line(&mut line).unwrap();
        assert!(
            read > 0,
            "the stream ended before the notice: {seen}{found}"
        );
        found.push_str(&line);
        if found.contains("event: preferences") && found.contains("\"locale\":\"ja\"") {
            break;
        }
        assert!(!found.contains("event: changed"), "{found}");
    }
    assert!(!found.contains("event: changed"), "{found}");
    server.stop();
}
