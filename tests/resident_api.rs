//! The launcher routes: they start, list and stop a headless session through the board's own
//! routes, and are served on the local entrance only. The agent CLI is a fake script named by
//! `AGBOARD_CLAUDE_BIN`; the server runs on port 0 in a temporary data directory.
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::sync::OnceLock;

use serde_json::Value;
use tempfile::{TempDir, tempdir};

use common::{Running, demo_project};

const FAKE: &str = r#"#!/bin/sh
case "$1" in
  auth) echo '{"loggedIn":true}'; exit 0 ;;
esac
exec sleep 60
"#;

static BIN: OnceLock<TempDir> = OnceLock::new();

fn fake_claude() {
    let dir = BIN.get_or_init(|| {
        let dir = tempdir().unwrap();
        let path = dir.path().join("claude");
        std::fs::write(&path, FAKE).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        // SAFETY: set once, before any server of this test binary starts.
        unsafe { std::env::set_var("AGBOARD_CLAUDE_BIN", path) };
        dir
    });
    let _ = dir;
}

fn project_id(server: &Running) -> String {
    let projects = server.get("/api/projects").json();
    projects["projects"][0]["id"].as_str().unwrap().to_string()
}

#[test]
fn a_session_is_launched_listed_refused_twice_and_stopped() {
    fake_claude();
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let id = project_id(&server);
    let base = format!("/api/projects/{id}/sessions");

    let models = server.get(&format!("{base}/models?tool=claude-code"));
    assert_eq!(models.status, 200, "{}", models.body);
    assert_eq!(models.json()["models"][0]["id"], "opus");

    let launched = server.write(
        "POST",
        &format!("{base}/launch"),
        Some(r#"{"tool":"claude-code","model":"sonnet"}"#),
    );
    assert_eq!(launched.status, 200, "{}", launched.body);
    let body: Value = launched.json();
    assert_eq!(body["launched"]["tool"], "claude-code");
    assert_eq!(body["launched"]["model"], "sonnet");
    assert!(body["launched"].get("pid").is_none());

    let listed = server.get(&base).json();
    assert_eq!(listed["launched"][0]["tool"], "claude-code");
    assert_eq!(listed["counts"]["total"], 0);

    let again = server.write(
        "POST",
        &format!("{base}/launch"),
        Some(r#"{"tool":"claude-code"}"#),
    );
    assert_eq!(again.status, 409);
    assert_eq!(again.code(), "session_launch_refused");

    let stopped = server.write("POST", &format!("{base}/stop"), Some("{}"));
    assert_eq!(stopped.status, 200);
    assert_eq!(stopped.json()["stopped"], true);
    assert_eq!(
        server.get(&base).json()["launched"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    let relaunched = server.write(
        "POST",
        &format!("{base}/launch"),
        Some(r#"{"tool":"claude-code"}"#),
    );
    assert_eq!(relaunched.status, 200, "{}", relaunched.body);
    // Stopping the server stops the child it launched.
    server.stop();
}

#[test]
fn launching_needs_the_page_guard_and_a_known_tool_and_project() {
    fake_claude();
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let id = project_id(&server);
    let launch = format!("/api/projects/{id}/sessions/launch");

    let unguarded = server.request(
        "POST",
        &launch,
        Some(r#"{"tool":"claude-code"}"#),
        &[],
        Some("application/json"),
    );
    assert_eq!(unguarded.status, 403);

    let unknown = server.write("POST", &launch, Some(r#"{"tool":"unknown"}"#));
    assert_eq!(unknown.status, 422);
    assert_eq!(unknown.code(), "invalid_value");

    let missing = server.write(
        "POST",
        "/api/projects/ffffffffffffffffffffffffffffffff/sessions/launch",
        Some(r#"{"tool":"claude-code"}"#),
    );
    assert_eq!(missing.status, 404);
    assert_eq!(missing.code(), "project_not_found");
    server.stop();
}

#[test]
fn health_is_listed_and_auto_start_is_saved_guarded_and_used_at_the_next_start() {
    fake_claude();
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let id = project_id(&server);
    let base = format!("/api/projects/{id}/sessions");

    let health = server.get(&base).json()["health"].clone();
    assert_eq!(health["tool"], Value::Null);
    assert_eq!(health["state"], "stopped");
    assert_eq!(health["autoStart"], Value::Null);

    let unguarded = server.request(
        "PUT",
        &format!("{base}/autostart"),
        Some(r#"{"tool":"claude-code","enabled":true}"#),
        &[],
        Some("application/json"),
    );
    assert_eq!(unguarded.status, 403);
    for body in [
        r#"{"tool":"unknown","enabled":true}"#,
        r#"{"enabled":true}"#,
        r#"{"tool":"claude-code","enabled":true,"model":"--help"}"#,
    ] {
        let refused = server.write("PUT", &format!("{base}/autostart"), Some(body));
        assert_eq!(refused.status, 422, "{body}");
    }

    let saved = server.write(
        "PUT",
        &format!("{base}/autostart"),
        Some(r#"{"tool":"claude-code","enabled":true,"model":"sonnet"}"#),
    );
    assert_eq!(saved.status, 200, "{}", saved.body);
    assert_eq!(saved.json()["autoStart"]["projectId"], id.as_str());
    assert_eq!(saved.json()["autoStart"]["tool"], "claude-code");
    let health = server.get(&base).json()["health"].clone();
    assert_eq!(health["autoStart"]["model"], "sonnet");
    assert_eq!(health["state"], "stopped");
    server.stop();

    // The next server starts the session by itself.
    let server = Running::start(home.path());
    let mut state = Value::Null;
    for _ in 0..600 {
        state = server.get(&base).json()["health"].clone();
        if state["state"] == "running" {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(state["state"], "running", "{state}");
    assert_eq!(state["tool"], "claude-code");
    assert_eq!(server.get(&base).json()["launched"][0]["model"], "sonnet");

    let off = server.write(
        "PUT",
        &format!("{base}/autostart"),
        Some(r#"{"enabled":false}"#),
    );
    assert_eq!(off.json()["autoStart"], Value::Null);
    // A stop names no tool.
    let stopped = server.write("POST", &format!("{base}/stop"), Some("{}"));
    assert_eq!(stopped.status, 200);
    assert_eq!(stopped.json()["stopped"], true);
    let health = server.get(&base).json()["health"].clone();
    assert_eq!(health["state"], "stopped");
    assert_eq!(health["autoStart"], Value::Null);
    server.stop();
}
