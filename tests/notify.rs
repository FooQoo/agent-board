//! Tests for the notification client. The peers are plain
//! `TcpListener`s in the test, so no server is involved.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use agent_board::interact::notify::{NOTIFY_TIMEOUT, notify_port, notify_serve};

// AGBOARD_HOME is process-global; tests that call `notify_serve` hold this lock.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn with_home<T>(home: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: access to the environment is serialized by ENV_LOCK.
    unsafe { std::env::set_var("AGBOARD_HOME", home) };
    let result = f();
    // SAFETY: as above.
    unsafe { std::env::remove_var("AGBOARD_HOME") };
    result
}

fn write_serve_json(home: &Path, port: u16) {
    let text = format!(
        r#"{{"pid":{},"port":{port},"started_at":"2026-10-02T01:00:00Z"}}"#,
        std::process::id()
    );
    std::fs::write(home.join("serve.json"), text).unwrap();
}

/// A port nothing listens on.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Run `f` and report whether it took at most `limit` plus scheduling slack.
fn timed<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let value = f();
    (value, start.elapsed())
}

/// What an elapsed time may be when the budget is 300 ms (some slack for a
/// busy test machine; the budget itself is checked by the peers below).
const SLACK_LIMIT: Duration = Duration::from_millis(450);

/// A peer that reads the request head and answers with `reply` (raw bytes),
/// then returns what it received.
fn peer_replying(reply: &'static str) -> (u16, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        let mut buf = [0u8; 512];
        while !request.windows(4).any(|w| w == b"\r\n\r\n") {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => request.extend_from_slice(&buf[..n]),
            }
        }
        let _ = stream.write_all(reply.as_bytes());
        String::from_utf8_lossy(&request).into_owned()
    });
    (port, handle)
}

const NO_CONTENT: &str = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

#[test]
fn without_a_serve_json_it_is_false() {
    let home = tempfile::tempdir().unwrap();
    let (result, elapsed) = timed(|| with_home(home.path(), notify_serve));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");
}

#[test]
fn a_broken_serve_json_is_false() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("serve.json"), "{oops").unwrap();
    assert!(!with_home(home.path(), notify_serve));
}

#[test]
fn a_port_nobody_listens_on_is_false_and_fast() {
    let (result, elapsed) = timed(|| notify_port(closed_port(), NOTIFY_TIMEOUT));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");

    let home = tempfile::tempdir().unwrap();
    write_serve_json(home.path(), closed_port());
    let (result, elapsed) = timed(|| with_home(home.path(), notify_serve));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");
}

#[test]
fn the_request_is_a_post_to_api_notify_with_the_loopback_host() {
    let (port, peer) = peer_replying(NO_CONTENT);
    assert!(notify_port(port, NOTIFY_TIMEOUT));
    let request = peer.join().unwrap();
    let mut lines = request.split("\r\n");
    assert_eq!(lines.next(), Some("POST /api/notify HTTP/1.1"));
    assert!(
        request.contains(&format!("\r\nHost: 127.0.0.1:{port}\r\n")),
        "{request:?}"
    );
}

#[test]
fn notify_serve_reads_the_port_from_serve_json_and_gets_204() {
    let (port, peer) = peer_replying(NO_CONTENT);
    let home = tempfile::tempdir().unwrap();
    write_serve_json(home.path(), port);
    assert!(with_home(home.path(), notify_serve));
    assert!(
        peer.join()
            .unwrap()
            .starts_with("POST /api/notify HTTP/1.1\r\n")
    );
}

#[test]
fn a_reply_other_than_204_is_false() {
    for reply in [
        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        "not http at all\r\n\r\n",
        "",
    ] {
        let (port, peer) = peer_replying(reply);
        assert!(!notify_port(port, NOTIFY_TIMEOUT), "{reply:?}");
        let _ = peer.join();
    }
}

#[test]
fn a_peer_that_never_answers_is_false_within_the_budget() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    // The connection is accepted by the OS backlog; nothing ever replies.
    let (result, elapsed) = timed(|| notify_port(port, NOTIFY_TIMEOUT));
    assert!(!result);
    assert!(
        elapsed >= Duration::from_millis(250),
        "gave up too early: {elapsed:?}"
    );
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");

    let home = tempfile::tempdir().unwrap();
    write_serve_json(home.path(), port);
    let (result, elapsed) = timed(|| with_home(home.path(), notify_serve));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");
    drop(listener);
}

#[test]
fn a_peer_that_drips_its_reply_cannot_stretch_the_budget() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0u8; 512];
        let _ = stream.read(&mut buf);
        for byte in b"HTTP/1.1 204 No Content\r\n\r\n" {
            if stream.write_all(&[*byte]).is_err() {
                return;
            }
            thread::sleep(Duration::from_millis(40));
        }
    });
    let (result, elapsed) = timed(|| notify_port(port, NOTIFY_TIMEOUT));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");
    peer.join().unwrap();
}

#[test]
fn a_peer_that_closes_at_once_is_false() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let peer = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        drop(stream);
    });
    let (result, elapsed) = timed(|| notify_port(port, NOTIFY_TIMEOUT));
    assert!(!result);
    assert!(elapsed < SLACK_LIMIT, "{elapsed:?}");
    peer.join().unwrap();
}

#[test]
fn a_zero_timeout_is_false_without_panicking() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(!notify_port(port, Duration::ZERO));
}

#[test]
fn the_budget_is_300_milliseconds() {
    assert_eq!(NOTIFY_TIMEOUT, Duration::from_millis(300));
}
