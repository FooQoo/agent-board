//! The agent sessions attached to the board: registering on connect, the attributes, leaving the
//! count after the grace period, a reconnect counted once, and the real `wait --until task`
//! command naming itself. Servers listen on port 0 in a temporary data directory, and the grace
//! period is shortened with `AGBOARD_SESSION_GRACE_MS`.

mod common;
#[path = "support/serve_process.rs"]
mod serve_process;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::sync::{Mutex, Once};
use std::time::{Duration, Instant};

use serde_json::Value;
use serve_process::ServeProcess;
use tempfile::tempdir;

use common::Running;

const GRACE_MS: u64 = 700;
const PROJECT: &str = "0123456789abcdef0123456789abcdef";

static SERIAL: Mutex<()> = Mutex::new(());
static GRACE: Once = Once::new();

/// A server whose sessions leave the count `GRACE_MS` after their stream closes.
fn start(home: &std::path::Path) -> Running {
    GRACE.call_once(|| {
        // SAFETY: set once, before any server of this test binary starts; tests of this file
        // are serialized and none reads the environment concurrently.
        unsafe { std::env::set_var("AGBOARD_SESSION_GRACE_MS", GRACE_MS.to_string()) };
    });
    Running::start(home)
}

/// An open `/api/events` stream that names a session.
fn attach(server: &Running, key: &str, tool: &str, origin: &str) -> TcpStream {
    let mut stream = TcpStream::connect(server.addr).unwrap();
    write!(
        stream,
        "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: text/event-stream\r\n\
         x-agboard-wait: 1\r\nx-agboard-session: {key}\r\nx-agboard-session-tool: {tool}\r\n\
         x-agboard-session-origin: {origin}\r\nx-agboard-session-project: {PROJECT}\r\n\r\n",
        server.port()
    )
    .unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut seen = String::new();
    let mut chunk = [0u8; 1024];
    while !seen.contains("event: ready") {
        let n = stream.read(&mut chunk).unwrap();
        assert!(n > 0, "stream closed before ready: {seen}");
        seen.push_str(&String::from_utf8_lossy(&chunk[..n]));
    }
    stream
}

fn sessions(server: &Running) -> Value {
    let reply = server.get(&format!("/api/projects/{PROJECT}/sessions"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.json()
}

fn wait_for_total(server: &Running, total: u64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let list = sessions(server);
        if list["counts"]["total"] == total {
            return list;
        }
        assert!(Instant::now() < deadline, "never reached {total}: {list}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_session_is_counted_with_its_attributes_while_its_stream_is_open() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let server = start(home.path());
    assert_eq!(sessions(&server)["counts"]["total"], 0);

    let _claude = attach(&server, "claude:aaaa", "claude-code", "board");
    let _codex = attach(&server, "codex:bbbb", "codex", "external");
    let _other = attach(&server, "ppid:cccc", "unknown", "external");

    let list = sessions(&server);
    assert_eq!(list["counts"]["total"], 3);
    assert_eq!(list["counts"]["connected"], 3);
    assert_eq!(list["counts"]["byTool"]["claude-code"], 1);
    assert_eq!(list["counts"]["byTool"]["codex"], 1);
    assert_eq!(list["counts"]["byTool"]["unknown"], 1);
    assert_eq!(list["counts"]["byOrigin"]["board"], 1);
    assert_eq!(list["counts"]["byOrigin"]["external"], 2);
    let first = &list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["id"] == "claude:aaaa")
        .unwrap()
        .clone();
    assert_eq!(first["tool"], "claude-code");
    assert_eq!(first["origin"], "board");
    assert_eq!(first["state"], "connected");
    assert!(first["connectedAt"].as_str().unwrap().ends_with('Z'));
    assert!(first["lastSeenAt"].as_str().unwrap().ends_with('Z'));

    // Another project has its own sessions.
    let other = server.get("/api/projects/ffffffffffffffffffffffffffffffff/sessions");
    assert_eq!(other.json()["counts"]["total"], 0);
}

#[test]
fn a_stopped_session_is_in_grace_and_then_leaves_the_count() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let server = start(home.path());

    let stream = attach(&server, "codex:aaaa", "codex", "external");
    drop(stream);
    let deadline = Instant::now() + Duration::from_secs(5);
    let in_grace = loop {
        let list = sessions(&server);
        if list["counts"]["connected"] == 0 && list["counts"]["total"] == 1 {
            break list;
        }
        assert!(Instant::now() < deadline, "never in grace: {list}");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(in_grace["sessions"][0]["state"], "grace");

    let gone = wait_for_total(&server, 0);
    assert_eq!(gone["sessions"].as_array().unwrap().len(), 0);
}

#[test]
fn a_reconnect_within_the_grace_period_is_one_session() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let server = start(home.path());

    let first = attach(&server, "claude:aaaa", "claude-code", "external");
    let connected_at = sessions(&server)["sessions"][0]["connectedAt"].clone();
    drop(first);
    let second = attach(&server, "claude:aaaa", "claude-code", "external");

    let list = sessions(&server);
    assert_eq!(list["counts"]["total"], 1);
    assert_eq!(list["counts"]["connected"], 1);
    assert_eq!(list["sessions"][0]["connectedAt"], connected_at);

    // It stays counted past the first stream's grace period because the second is open.
    std::thread::sleep(Duration::from_millis(GRACE_MS + 300));
    assert_eq!(sessions(&server)["counts"]["connected"], 1);
    drop(second);
}

#[test]
fn a_stream_without_valid_session_headers_is_not_counted() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let server = start(home.path());

    let _bad_key = attach(&server, "has%20space", "codex", "external");
    let _board_page = {
        let mut stream = TcpStream::connect(server.addr).unwrap();
        write!(
            stream,
            "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
            server.port()
        )
        .unwrap();
        stream
    };
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(sessions(&server)["counts"]["total"], 0);
    let refused = server.get("/api/projects/not-a-project/sessions");
    assert_eq!(refused.status, 422, "{}", refused.body);
}

/// `agboard serve` as its own process, with the short grace period.
fn serve(home: &std::path::Path) -> (ServeProcess, u16) {
    let child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("AGBOARD_SESSION_GRACE_MS", GRACE_MS.to_string())
        .args(["serve", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut server = ServeProcess(child);
    let mut line = String::new();
    BufReader::new(server.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let port = line
        .split("127.0.0.1:")
        .nth(1)
        .map(|tail| {
            tail.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
        })
        .and_then(|digits| digits.parse().ok())
        .unwrap_or_else(|| panic!("no port in {line:?}"));
    (server, port)
}

fn get_json(port: u16, path: &str) -> Value {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut text = String::new();
    stream.read_to_string(&mut text).unwrap();
    let body = text.split("\r\n\r\n").nth(1).unwrap();
    // The body may be chunked; keep the JSON object only.
    let start = body.find('{').unwrap();
    let end = body.rfind('}').unwrap();
    serde_json::from_str(&body[start..=end]).unwrap()
}

#[test]
fn wait_until_task_names_its_session_and_leaves_the_count_when_it_ends() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_AUTOSTART", "0")
            .env("AGBOARD_OPEN_BROWSER", "0")
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", home.path())
            .env("TZ", "UTC")
            .args(["--project", "Agent Board"])
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let snapshot: Value = serde_json::from_slice(&run(&["snapshot", "--json"]).stdout).unwrap();
    let project = snapshot["project"]["id"].as_str().unwrap().to_string();
    let (_server, port) = serve(home.path());

    let waiter = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home.path())
        .env("CLAUDECODE", "1")
        .env("CLAUDE_CODE_SESSION_ID", "session-under-test")
        .env_remove("AGBOARD_RESIDENT_ID")
        .args([
            "--project",
            "Agent Board",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "3",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    let path = format!("/api/projects/{project}/sessions");
    let deadline = Instant::now() + Duration::from_secs(5);
    let list = loop {
        let list = get_json(port, &path);
        if list["counts"]["total"] == 1 {
            break list;
        }
        assert!(
            Instant::now() < deadline,
            "the wait never registered: {list}"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(list["sessions"][0]["tool"], "claude-code");
    assert_eq!(list["sessions"][0]["origin"], "external");
    assert_eq!(list["sessions"][0]["state"], "connected");
    let id = list["sessions"][0]["id"].as_str().unwrap();
    assert!(id.starts_with("claude:") && !id.contains("session-under-test"));

    // The idle timeout ends the wait with its unchanged JSON, and the session leaves the count.
    let output = waiter.wait_with_output().unwrap();
    let answer: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(answer["kind"], "idle_timeout");
    let deadline = Instant::now() + Duration::from_secs(10);
    while get_json(port, &path)["counts"]["total"] != 0 {
        assert!(
            Instant::now() < deadline,
            "the session never left the count"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// One `agboard` command with the board's test settings and an agent session's variables.
fn agboard_in_session(home: &std::path::Path, session: Option<&str>, args: &[&str]) -> Vec<u8> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_agboard"));
    command
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .env_remove("AGBOARD_RESIDENT_ID")
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_SESSION_ID")
        .env_remove("CODEX_THREAD_ID")
        .args(["--project", "Agent Board"])
        .args(args);
    if let Some(id) = session {
        command.env("CLAUDE_CODE_SESSION_ID", id);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn a_command_run_in_an_agent_session_counts_it_as_an_external_session() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    agboard_in_session(home.path(), None, &["init"]);
    let snapshot: Value = serde_json::from_slice(&agboard_in_session(
        home.path(),
        None,
        &["snapshot", "--json"],
    ))
    .unwrap();
    let project = snapshot["project"]["id"].as_str().unwrap().to_string();
    let (_server, port) = serve(home.path());
    let path = format!("/api/projects/{project}/sessions");

    // A command outside any agent session (the parent process names it) is not counted.
    agboard_in_session(home.path(), None, &["ls"]);
    assert_eq!(get_json(port, &path)["counts"]["total"], 0);

    // An ordinary command of an agent session that does not wait is.
    agboard_in_session(home.path(), Some("session-under-test"), &["ls"]);
    let list = get_json(port, &path);
    assert_eq!(list["counts"]["total"], 1, "{list}");
    assert_eq!(list["counts"]["connected"], 0);
    assert_eq!(list["counts"]["byOrigin"]["external"], 1);
    let id = list["sessions"][0]["id"].as_str().unwrap();
    assert!(id.starts_with("claude:") && !id.contains("session-under-test"));
    assert_eq!(list["sessions"][0]["tool"], "claude-code");
    assert_eq!(list["sessions"][0]["state"], "grace");

    // A second command of the same session is the same session.
    agboard_in_session(home.path(), Some("session-under-test"), &["ls"]);
    assert_eq!(get_json(port, &path)["counts"]["total"], 1);
}

#[test]
fn a_touch_that_names_a_board_session_or_another_project_is_ignored() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    let server = start(home.path());
    let touch = |path_project: &str, origin: &str| {
        server.request(
            "POST",
            &format!("/api/projects/{path_project}/sessions/touch"),
            None,
            &[
                ("x-agboard-session".to_string(), "claude:aaaa".to_string()),
                (
                    "x-agboard-session-tool".to_string(),
                    "claude-code".to_string(),
                ),
                ("x-agboard-session-origin".to_string(), origin.to_string()),
                ("x-agboard-session-project".to_string(), PROJECT.to_string()),
            ],
            None,
        )
    };
    assert_eq!(touch(PROJECT, "board").status, 204);
    assert_eq!(
        touch("ffffffffffffffffffffffffffffffff", "external").status,
        204
    );
    assert_eq!(sessions(&server)["counts"]["total"], 0);
    assert_eq!(touch(PROJECT, "external").status, 204);
    assert_eq!(sessions(&server)["counts"]["total"], 1);
}

#[test]
fn commands_succeed_quickly_when_no_server_runs() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let home = tempdir().unwrap();
    agboard_in_session(home.path(), None, &["init"]);
    // No serve.json at all.
    let start = Instant::now();
    agboard_in_session(home.path(), Some("session-under-test"), &["ls"]);
    // A serve.json that names a port nothing listens on.
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    std::fs::write(
        home.path().join("serve.json"),
        format!(r#"{{"pid":1,"port":{port},"started_at":"2026-01-01T00:00:00Z"}}"#),
    )
    .unwrap();
    agboard_in_session(home.path(), Some("session-under-test"), &["ls"]);
    assert!(start.elapsed() < Duration::from_secs(5));
}
