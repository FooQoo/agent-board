//! The launcher routes: they start, list and stop a headless session through the board's own
//! routes, and are served on the local entrance only. The agent CLI is a fake script named by
//! `AGBOARD_CLAUDE_BIN`; the server runs on port 0 in a temporary data directory.
#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::{TempDir, tempdir};

use common::{Running, demo_project};

const FAKE: &str = r#"#!/bin/sh
case "$1" in
  auth) echo '{"loggedIn":true}'; exit 0 ;;
esac
# Two-way stream-json: the first user message arrives on stdin, then the session idles until
# its input closes.
IFS= read -r first
echo '{"type":"system","subtype":"init","session_id":"api-fake","claude_code_version":"9.9.9"}'
cat > /dev/null
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

/// The session list once the launched session is in it, waiting up to five seconds.
fn board_session_listed(server: &Running, base: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let listed = server.get(base).json();
        if listed["counts"]["total"] != 0 || Instant::now() >= deadline {
            return listed;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
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
    // The launched session joins the list as a board session once it reports its first event.
    let listed = board_session_listed(&server, &base);
    assert_eq!(listed["counts"]["total"], 1);
    assert_eq!(listed["counts"]["byOrigin"]["board"], 1);
    let session = &listed["sessions"][0];
    assert_eq!(session["origin"], "board");
    assert!(session["id"].as_str().unwrap().starts_with("resident:"));

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
    let after_stop = server.get(&base).json();
    assert_eq!(after_stop["launched"].as_array().unwrap().len(), 0);
    assert_eq!(after_stop["counts"]["total"], 0);

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

#[test]
fn the_log_tail_is_read_whole_cut_at_a_line_or_missing_and_only_for_a_known_tool() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let id = project_id(&server);
    let url = |tool: &str| format!("/api/projects/{id}/sessions/log?tool={tool}");
    let log = home.path().join("resident").join("claude-code.log");

    // No launch yet: no file.
    let missing = server.get(&url("claude-code"));
    assert_eq!(missing.status, 200, "{}", missing.body);
    assert_eq!(
        missing.json(),
        serde_json::json!({"tool":"claude-code","exists":false,"text":"","truncated":false,"size":0})
    );

    // A small log comes back whole.
    std::fs::create_dir_all(log.parent().unwrap()).unwrap();
    std::fs::write(&log, "first\nsecond \u{3042}\n").unwrap();
    let small = server.get(&url("claude-code")).json();
    assert_eq!(small["exists"], true);
    assert_eq!(small["text"], "first\nsecond \u{3042}\n");
    assert_eq!(small["truncated"], false);
    assert_eq!(small["size"], "first\nsecond \u{3042}\n".len());
    // The other tool has its own file.
    assert_eq!(server.get(&url("codex")).json()["exists"], false);

    // A log over 64 KiB keeps the last lines, cut at a line boundary.
    let line = format!("{}\n", "x".repeat(99)); // 100 bytes
    let total = 1000;
    let mut body = String::new();
    for n in 0..total {
        body.push_str(&format!("{n:04}{}", &line[4..]));
    }
    std::fs::write(&log, &body).unwrap();
    let big = server.get(&url("claude-code")).json();
    assert_eq!(big["truncated"], true);
    assert_eq!(big["size"], body.len());
    let text = big["text"].as_str().unwrap();
    assert!(text.len() <= 64 * 1024);
    assert!(text.ends_with(&format!("{:04}{}", total - 1, &line[4..])));
    assert!(
        text.lines()
            .all(|l| l.len() == 99 && l.starts_with(|c: char| c.is_ascii_digit()))
    );
    assert!(body.ends_with(text));

    // A tool the launcher cannot start, or none at all, is refused.
    let unknown = server.get(&url("unknown"));
    assert_eq!(unknown.status, 422, "{}", unknown.body);
    assert_eq!(unknown.code(), "invalid_value");
    assert_eq!(server.get(&url("other")).status, 422);
    server.stop();
}

#[test]
fn the_log_is_refused_to_a_page_that_is_not_the_local_one() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let id = project_id(&server);
    let path = format!("/api/projects/{id}/sessions/log?tool=codex");
    let foreign = server.request(
        "GET",
        &path,
        None,
        &[("Host".to_string(), "example.com".to_string())],
        None,
    );
    assert_eq!(foreign.status, 403, "{}", foreign.body);
    server.stop();
}
