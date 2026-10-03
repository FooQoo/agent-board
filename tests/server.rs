//! Integration tests for the web server.

use std::path::Path;
use std::process::Command;

/// Compile the real `build.rs` and run it against `manifest_dir`, the way
/// Cargo would: `CARGO_MANIFEST_DIR` points at the crate root.
fn run_build_script(manifest_dir: &Path) -> std::process::Output {
    let scratch = tempfile::tempdir().unwrap();
    let exe = scratch.path().join("build_script");
    let compiled = Command::new("rustc")
        .args(["--edition", "2024", "--crate-name", "build_script", "-o"])
        .arg(&exe)
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "build.rs does not compile: {}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    Command::new(&exe)
        .env("CARGO_MANIFEST_DIR", manifest_dir)
        .output()
        .unwrap()
}

fn fake_manifest(files: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for rel in files {
        let path = dir.path().join("web/dist").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    dir
}

#[test]
fn build_script_stops_the_build_without_the_web_assets() {
    let dir = fake_manifest(&[]);
    let out = run_build_script(dir.path());
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Run \"pnpm --dir web build\" first."),
        "{stderr}"
    );
}

#[test]
fn build_script_stops_the_build_when_one_asset_is_missing() {
    let dir = fake_manifest(&["index.html", "assets/app.css"]);
    let out = run_build_script(dir.path());
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("assets/app.js"), "{stderr}");
    assert!(
        stderr.contains("Run \"pnpm --dir web build\" first."),
        "{stderr}"
    );
}

#[test]
fn build_script_passes_and_watches_the_dist_directory_when_built() {
    let dir = fake_manifest(&["index.html", "assets/app.js", "assets/app.css"]);
    let out = run_build_script(dir.path());
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("cargo:rerun-if-changed=web/dist"),
        "{stdout}"
    );
}

// ---------------------------------------------------------------- harness

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use chrono::{DateTime, TimeZone, Utc};
use skan::domain::{Column, RunState};
use skan::error::SkanError;
use skan::server::{ServeConfig, run_until};
use skan::store::Store;

// SKAN_HOME is process-global. It is only needed while a server starts (the
// server captures its paths then), so the lock is released once it is ready.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn with_home<T>(home: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: access to the environment is serialized by ENV_LOCK.
    unsafe { std::env::set_var("SKAN_HOME", home) };
    let result = f();
    // SAFETY: as above.
    unsafe { std::env::remove_var("SKAN_HOME") };
    result
}

fn t(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, minute, 0).unwrap()
}

fn store_in(home: &Path) -> Store {
    Store::open(&home.join("board.db")).unwrap()
}

/// A data directory with board "main" and cards #1 (todo), #2 (doing, running)
/// and #3 (doing, pending with a reason).
fn board_home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let store = store_in(home.path());
    store.create_board("main", t(0)).unwrap();
    store.add_card("First card", "Some details", t(1)).unwrap();
    store.add_card("Second card", "", t(2)).unwrap();
    store.add_card("Third card", "", t(3)).unwrap();
    store.move_card(2, Column::Doing, t(4)).unwrap();
    store.move_card(3, Column::Doing, t(5)).unwrap();
    store
        .set_run_state(2, RunState::Running, None, t(6))
        .unwrap();
    store
        .set_run_state(3, RunState::Pending, Some("Waiting for review"), t(7))
        .unwrap();
    home
}

fn card_ids(home: &Path) -> Vec<i64> {
    let mut ids: Vec<i64> = store_in(home)
        .snapshot()
        .unwrap()
        .cards
        .iter()
        .map(|c| c.id)
        .collect();
    ids.sort();
    ids
}

struct Running {
    addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), SkanError>>>,
}

impl Running {
    /// Start a server for the data directory `home` on `port` (0 = any) and
    /// wait until it is ready, or return the error it stopped with.
    fn start(home: &Path, port: u16) -> Result<Running, SkanError> {
        with_home(home, || {
            let (ready_tx, ready_rx) = mpsc::channel();
            let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
            let handle = std::thread::spawn(move || {
                run_until(
                    ServeConfig { port },
                    async move {
                        let _ = stop_rx.await;
                    },
                    move |addr| {
                        let _ = ready_tx.send(addr);
                    },
                )
            });
            match ready_rx.recv_timeout(Duration::from_secs(10)) {
                Ok(addr) => Ok(Running {
                    addr,
                    stop: Some(stop_tx),
                    handle: Some(handle),
                }),
                Err(_) => match handle.join() {
                    Ok(result) => Err(result.expect_err("stopped without becoming ready")),
                    Err(_) => panic!("the server thread panicked before it was ready"),
                },
            }
        })
    }

    fn port(&self) -> u16 {
        self.addr.port()
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    /// The headers a page served by this server sends for a delete.
    fn page_headers(&self, token: &str) -> Vec<(String, String)> {
        vec![
            ("Origin".into(), format!("http://127.0.0.1:{}", self.port())),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
            ("X-Skan-Token".into(), token.into()),
        ]
    }

    /// Fetch the session token the way a browser would, from `GET /`.
    fn token(&self) -> String {
        let page = self.get("/");
        let marker = "name=\"skan-token\" content=\"";
        let start = page.body.find(marker).expect("token meta tag") + marker.len();
        page.body[start..start + 64].to_string()
    }

    fn get(&self, path: &str) -> Reply {
        self.send("GET", path, &[])
    }

    fn send(&self, method: &str, path: &str, headers: &[(&str, &str)]) -> Reply {
        let owned: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        self.send_owned(method, path, &owned)
    }

    fn send_owned(&self, method: &str, path: &str, headers: &[(String, String)]) -> Reply {
        let mut builder = ureq::http::Request::builder()
            .method(method)
            .uri(self.url(path));
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into();
        let mut response = agent.run(builder.body(()).unwrap()).unwrap();
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .map(|v| v.to_str().unwrap().to_string())
        };
        let content_type = header("content-type");
        let cache_control = header("cache-control");
        let status = response.status().as_u16();
        let body = response.body_mut().read_to_string().unwrap_or_default();
        Reply {
            status,
            content_type,
            cache_control,
            body,
        }
    }

    fn delete_as_page(&self, id: i64) -> Reply {
        let headers = self.page_headers(&self.token());
        self.send_owned("DELETE", &format!("/api/cards/{id}"), &headers)
    }

    /// Open `GET /api/events` and wait for the `ready` event.
    fn events(&self) -> EventStream {
        let mut stream = TcpStream::connect(self.addr).unwrap();
        write!(
            stream,
            "GET /api/events HTTP/1.1\r\nHost: {}\r\nAccept: text/event-stream\r\n\r\n",
            self.addr
        )
        .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let mut events = EventStream {
            stream,
            received: String::new(),
        };
        events.wait_for("event: ready", Duration::from_secs(2));
        events
    }

    fn stop(mut self) -> Result<(), SkanError> {
        self.shutdown()
    }

    fn shutdown(&mut self) -> Result<(), SkanError> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        match self.handle.take() {
            Some(handle) => handle.join().expect("server thread panicked"),
            None => Ok(()),
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

struct Reply {
    status: u16,
    content_type: Option<String>,
    cache_control: Option<String>,
    body: String,
}

struct EventStream {
    stream: TcpStream,
    received: String,
}

impl EventStream {
    fn try_wait_for(&mut self, needle: &str, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        let mut chunk = [0u8; 4096];
        while Instant::now() < deadline {
            if self.received.contains(needle) {
                return true;
            }
            match self.stream.read(&mut chunk) {
                Ok(0) => return self.received.contains(needle),
                Ok(n) => self
                    .received
                    .push_str(&String::from_utf8_lossy(&chunk[..n])),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(e) => panic!("read failed: {e}"),
            }
        }
        self.received.contains(needle)
    }

    fn wait_for(&mut self, needle: &str, within: Duration) {
        assert!(
            self.try_wait_for(needle, within),
            "did not receive {needle:?} within {within:?}; got {:?}",
            self.received
        );
    }

    fn count(&self, needle: &str) -> usize {
        self.received.matches(needle).count()
    }
}

/// Positions of `keys` inside `text` must be strictly increasing.
fn assert_key_order(text: &str, keys: &[&str]) {
    let mut last = 0;
    for key in keys {
        let found = text[last..]
            .find(&format!("\"{key}\":"))
            .unwrap_or_else(|| panic!("key {key:?} missing or out of order in {text}"));
        last += found + key.len();
    }
}

// ---------------------------------------------------------------- pages and assets

#[test]
fn index_is_html_with_a_fresh_64_hex_token() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let page = server.get("/");
    assert_eq!(page.status, 200);
    assert_eq!(
        page.content_type.as_deref(),
        Some("text/html; charset=utf-8")
    );
    assert_eq!(page.cache_control.as_deref(), Some("no-store"));
    assert!(!page.body.contains("{{SKAN_TOKEN}}"));
    let token = server.token();
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
    assert!(
        page.body
            .contains(&format!("<meta name=\"skan-token\" content=\"{token}\" />"))
    );
    assert!(page.body.contains("src=\"/assets/app.js\""));
}

#[test]
fn the_token_is_stable_within_a_run_and_differs_between_runs() {
    let home = board_home();
    let first = Running::start(home.path(), 0).unwrap();
    assert_eq!(first.token(), first.token());
    let token_one = first.token();
    first.stop().unwrap();
    let second = Running::start(home.path(), 0).unwrap();
    assert_ne!(second.token(), token_one);
}

#[test]
fn assets_are_served_with_their_content_types() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("web/dist/assets");

    let js = server.get("/assets/app.js");
    assert_eq!(js.status, 200);
    assert_eq!(
        js.content_type.as_deref(),
        Some("text/javascript; charset=utf-8")
    );
    assert_eq!(js.cache_control.as_deref(), Some("no-store"));
    assert_eq!(
        js.body,
        std::fs::read_to_string(dist.join("app.js")).unwrap()
    );

    let css = server.get("/assets/app.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type.as_deref(), Some("text/css; charset=utf-8"));
    assert_eq!(css.cache_control.as_deref(), Some("no-store"));
    assert_eq!(
        css.body,
        std::fs::read_to_string(dist.join("app.css")).unwrap()
    );
}

// ---------------------------------------------------------------- API

#[test]
fn board_matches_the_stores_snapshot_in_the_model_shape() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let reply = server.get("/api/board");
    assert_eq!(reply.status, 200);
    assert_eq!(reply.content_type.as_deref(), Some("application/json"));

    let snapshot = store_in(home.path()).snapshot().unwrap();
    let expected = serde_json::json!({
        "board": {"name": "main", "created_at": "2026-10-02T01:00:00Z"},
        "cards": serde_json::to_value(&snapshot.cards).unwrap(),
    });
    let actual: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(actual["cards"].as_array().unwrap().len(), 3);

    // The documented key order, at the board and at each card.
    assert!(reply.body.starts_with(
        "{\"board\":{\"name\":\"main\",\"created_at\":\"2026-10-02T01:00:00Z\"},\"cards\":[{\"id\":1,"
    ));
    assert!(!reply.body.contains("next_card_id"));
    let card = &reply.body[reply.body.find("\"cards\"").unwrap()..];
    assert_key_order(
        card,
        &[
            "id",
            "title",
            "description",
            "column",
            "position",
            "run_state",
            "pending_reason",
            "created_at",
            "updated_at",
            "run_state_changed_at",
            "transitions",
        ],
    );
    assert_eq!(actual["cards"][2]["pending_reason"], "Waiting for review");
}

#[test]
fn board_reflects_changes_made_after_the_server_started() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    store_in(home.path())
        .add_card("Late card", "", t(10))
        .unwrap();
    let actual: serde_json::Value = serde_json::from_str(&server.get("/api/board").body).unwrap();
    assert_eq!(actual["cards"].as_array().unwrap().len(), 4);
}

#[test]
fn health_reports_ok_and_the_process_id() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let reply = server.get("/api/health");
    assert_eq!(reply.status, 200);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"ok": true, "pid": std::process::id()})
    );
}

#[test]
fn unknown_paths_are_404_and_wrong_methods_405() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    assert_eq!(server.get("/nope").status, 404);
    assert_eq!(server.get("/assets/other.js").status, 404);
    assert_eq!(server.send("POST", "/api/board", &[]).status, 405);
    assert_eq!(server.send("GET", "/api/notify", &[]).status, 405);
}

#[test]
fn notify_returns_204_without_a_body() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let reply = server.send("POST", "/api/notify", &[]);
    assert_eq!(reply.status, 204);
    assert_eq!(reply.body, "");
}

// ---------------------------------------------------------------- Host guard

#[test]
fn a_foreign_host_is_403_on_every_path() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let evil = format!("evil.example:{}", server.port());
    let requests = [
        ("GET", "/"),
        ("GET", "/assets/app.js"),
        ("GET", "/assets/app.css"),
        ("GET", "/api/board"),
        ("GET", "/api/events"),
        ("GET", "/api/health"),
        ("POST", "/api/notify"),
        ("DELETE", "/api/cards/1"),
        ("GET", "/nope"),
        ("POST", "/api/board"),
    ];
    for (method, path) in requests {
        let reply = server.send(method, path, &[("Host", evil.as_str())]);
        assert_eq!(reply.status, 403, "{method} {path}");
        let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body["error"]["code"], "forbidden", "{method} {path}");
        assert!(body["error"]["message"].is_string());
        assert!(body["error"]["reason"].is_string());
    }
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
}

#[test]
fn only_the_servers_own_port_is_an_accepted_host() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let port = server.port();
    for host in [
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        format!("LOCALHOST:{port}"),
    ] {
        assert_eq!(
            server
                .send("GET", "/api/health", &[("Host", host.as_str())])
                .status,
            200,
            "{host}"
        );
    }
    for host in [
        "127.0.0.1".to_string(),
        "localhost".to_string(),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
        format!("localhost.evil.example:{port}"),
        format!("127.0.0.1:{port}@evil.example"),
    ] {
        assert_eq!(
            server
                .send("GET", "/api/health", &[("Host", host.as_str())])
                .status,
            403,
            "{host}"
        );
    }
}

#[test]
fn a_request_without_a_host_header_is_403() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut stream = TcpStream::connect(server.addr).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(stream, "GET /api/board HTTP/1.0\r\n\r\n").unwrap();
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    assert!(
        response.starts_with("HTTP/1.0 403") || response.starts_with("HTTP/1.1 403"),
        "{response}"
    );
}

// ---------------------------------------------------------------- delete

#[test]
fn a_delete_meeting_all_four_conditions_returns_204_and_removes_the_card() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let reply = server.delete_as_page(2);
    assert_eq!(reply.status, 204);
    assert_eq!(reply.body, "");
    assert_eq!(card_ids(home.path()), vec![1, 3]);
    let board: serde_json::Value = serde_json::from_str(&server.get("/api/board").body).unwrap();
    assert_eq!(board["cards"].as_array().unwrap().len(), 2);
}

#[test]
fn localhost_origin_and_host_also_delete() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let port = server.port();
    let host = format!("localhost:{port}");
    let origin = format!("http://localhost:{port}");
    let reply = server.send(
        "DELETE",
        "/api/cards/1",
        &[
            ("Host", host.as_str()),
            ("Origin", origin.as_str()),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Skan-Token", token.as_str()),
        ],
    );
    assert_eq!(reply.status, 204);
    assert_eq!(card_ids(home.path()), vec![2, 3]);
}

#[test]
fn a_delete_missing_any_one_condition_is_403_and_the_card_remains() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let port = server.port();
    let origin = format!("http://127.0.0.1:{port}");
    let https_origin = format!("https://127.0.0.1:{port}");
    let wrong_token = "0".repeat(64);
    let evil_host = format!("evil.example:{port}");
    let same = Some("same-origin");

    // (case, Host, Origin, Sec-Fetch-Site, token); `None` leaves the header out.
    type Case<'a> = (
        &'a str,
        Option<&'a str>,
        Option<&'a str>,
        Option<&'a str>,
        Option<&'a str>,
    );
    let o = Some(origin.as_str());
    let tok = Some(token.as_str());
    let cases: Vec<Case> = vec![
        ("no token", None, o, same, None),
        ("wrong token", None, o, same, Some(wrong_token.as_str())),
        ("short token", None, o, same, Some("abc")),
        ("no origin", None, None, same, tok),
        ("other origin", None, Some("http://evil.example"), same, tok),
        (
            "origin wrong port",
            None,
            Some("http://127.0.0.1:1"),
            same,
            tok,
        ),
        ("https origin", None, Some(https_origin.as_str()), same, tok),
        ("no fetch site", None, o, None, tok),
        ("cross-site", None, o, Some("cross-site"), tok),
        ("same-site", None, o, Some("same-site"), tok),
        ("none", None, o, Some("none"), tok),
        ("other host", Some(evil_host.as_str()), o, same, tok),
    ];
    for (name, host, origin, site, token) in cases {
        let mut headers: Vec<(&str, &str)> = Vec::new();
        if let Some(v) = host {
            headers.push(("Host", v));
        }
        if let Some(v) = origin {
            headers.push(("Origin", v));
        }
        if let Some(v) = site {
            headers.push(("Sec-Fetch-Site", v));
        }
        if let Some(v) = token {
            headers.push(("X-Skan-Token", v));
        }
        let reply = server.send("DELETE", "/api/cards/1", &headers);
        assert_eq!(reply.status, 403, "{name}");
        let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body["error"]["code"], "forbidden", "{name}");
        assert_eq!(card_ids(home.path()), vec![1, 2, 3], "{name}");
    }
}

#[test]
fn the_token_is_not_accepted_from_a_query_string() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let origin = format!("http://127.0.0.1:{}", server.port());
    let reply = server.send(
        "DELETE",
        &format!("/api/cards/1?token={token}"),
        &[
            ("Origin", origin.as_str()),
            ("Sec-Fetch-Site", "same-origin"),
        ],
    );
    assert_eq!(reply.status, 403);
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
}

#[test]
fn deleting_a_missing_card_is_404_with_the_error_body() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let reply = server.delete_as_page(99);
    assert_eq!(reply.status, 404);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"error": {
            "code": "card_not_found",
            "message": "card #99 not found.",
            "reason": "No card has ID 99. Run \"skan ls\" to see the cards.",
        }})
    );
    for bad_id in ["abc", "0", "-1", "1.5"] {
        let headers = server.page_headers(&server.token());
        let reply = server.send_owned("DELETE", &format!("/api/cards/{bad_id}"), &headers);
        assert_eq!(reply.status, 404, "{bad_id}");
    }
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
}

#[test]
fn the_guard_runs_before_the_existence_check() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    assert_eq!(server.send("DELETE", "/api/cards/99", &[]).status, 403);
}

// ---------------------------------------------------------------- SSE

#[test]
fn events_start_with_ready_and_the_right_headers() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let events = server.events();
    assert!(
        events.received.starts_with("HTTP/1.1 200"),
        "{}",
        events.received
    );
    assert!(
        events
            .received
            .to_ascii_lowercase()
            .contains("content-type: text/event-stream")
    );
    assert!(events.received.contains("event: ready\ndata: {}\n\n"));
}

#[test]
fn notify_sends_changed_to_every_connected_client() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut first = server.events();
    let mut second = server.events();
    assert_eq!(server.send("POST", "/api/notify", &[]).status, 204);
    first.wait_for("event: changed\ndata: {}\n\n", Duration::from_secs(2));
    second.wait_for("event: changed\ndata: {}\n\n", Duration::from_secs(2));
}

#[test]
fn each_notify_sends_one_changed() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut events = server.events();
    for n in 1..=3 {
        server.send("POST", "/api/notify", &[]);
        let deadline = Instant::now() + Duration::from_secs(2);
        while events.count("event: changed") < n && Instant::now() < deadline {
            events.try_wait_for("never-appears", Duration::from_millis(50));
        }
        assert_eq!(events.count("event: changed"), n);
    }
}

#[test]
fn a_successful_delete_sends_changed_and_a_refused_one_does_not() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut events = server.events();
    assert_eq!(server.send("DELETE", "/api/cards/1", &[]).status, 403);
    assert_eq!(server.delete_as_page(99).status, 404);
    assert!(
        !events.try_wait_for("event: changed", Duration::from_millis(300)),
        "{}",
        events.received
    );
    assert_eq!(server.delete_as_page(1).status, 204);
    events.wait_for("event: changed\ndata: {}\n\n", Duration::from_secs(2));
}

#[test]
fn a_keep_alive_comment_arrives_within_sixteen_seconds() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut events = server.events();
    events.wait_for("\n:", Duration::from_secs(17));
}

// ---------------------------------------------------------------- serve.json and startup

use skan::paths::ServeInfo;

fn serve_json(home: &Path) -> Option<ServeInfo> {
    let text = std::fs::read_to_string(home.join("serve.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_serve_json(home: &Path, info: &ServeInfo) {
    std::fs::write(
        home.join("serve.json"),
        serde_json::to_string(info).unwrap(),
    )
    .unwrap();
}

/// A port nothing listens on.
fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

/// A stand-in for another server that answers `GET /api/health` with `pid`.
fn fake_health_server(pid: u32) -> (u16, JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            // Read the whole request first, or closing with unread data resets
            // the connection before the client sees the response.
            let mut request = Vec::new();
            let mut buf = [0u8; 512];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&buf[..n]),
                }
            }
            let body = format!("{{\"ok\":true,\"pid\":{pid}}}");
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (port, handle)
}

fn info(pid: u32, port: u16) -> ServeInfo {
    ServeInfo {
        pid,
        port,
        started_at: "2026-10-02T01:00:00Z".into(),
    }
}

#[test]
fn serve_json_is_written_while_running_and_removed_when_the_server_stops() {
    let home = board_home();
    assert_eq!(serve_json(home.path()), None);
    let server = Running::start(home.path(), 0).unwrap();
    let written = serve_json(home.path()).expect("serve.json is written before ready");
    assert_eq!(written.pid, std::process::id());
    assert_eq!(written.port, server.port());
    assert!(
        skan::clock::parse_utc(&written.started_at).is_ok(),
        "{}",
        written.started_at
    );
    server.stop().unwrap();
    assert_eq!(serve_json(home.path()), None);
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn serve_json_never_holds_the_session_token() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let text = std::fs::read_to_string(home.path().join("serve.json")).unwrap();
    assert!(!text.contains(&token));
}

#[test]
fn an_uninitialized_board_is_not_initialized_and_leaves_no_serve_json() {
    let home = tempfile::tempdir().unwrap();
    let error = Running::start(home.path(), 0).err().unwrap();
    assert_eq!(error, SkanError::NotInitialized);
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn a_second_server_for_the_same_data_directory_is_already_serving() {
    let home = board_home();
    let first = Running::start(home.path(), 0).unwrap();
    let before = serve_json(home.path());
    let error = Running::start(home.path(), 0).err().unwrap();
    assert_eq!(error, SkanError::AlreadyServing { port: first.port() });
    // The first server is untouched.
    assert_eq!(serve_json(home.path()), before);
    assert_eq!(first.get("/api/health").status, 200);
    // Asking for the running server's own port is also "already serving".
    let error = Running::start(home.path(), first.port()).err().unwrap();
    assert_eq!(error, SkanError::AlreadyServing { port: first.port() });
    first.stop().unwrap();
}

#[test]
fn a_port_in_use_by_something_else_is_port_in_use() {
    let home = board_home();
    let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = blocker.local_addr().unwrap().port();
    let error = Running::start(home.path(), port).err().unwrap();
    assert_eq!(error, SkanError::PortInUse { port });
    assert_eq!(error.code(), "port_in_use");
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn a_serve_json_whose_server_is_gone_is_overwritten() {
    let home = board_home();
    write_serve_json(home.path(), &info(4_000_000, free_port()));
    let server = Running::start(home.path(), 0).unwrap();
    let written = serve_json(home.path()).unwrap();
    assert_eq!(written.pid, std::process::id());
    assert_eq!(written.port, server.port());
}

#[test]
fn a_serve_json_whose_health_reports_another_pid_is_overwritten() {
    let home = board_home();
    let (port, fake) = fake_health_server(1);
    write_serve_json(home.path(), &info(2, port));
    let server = Running::start(home.path(), 0).unwrap();
    assert_eq!(serve_json(home.path()).unwrap().port, server.port());
    fake.join().unwrap();
}

#[test]
fn a_serve_json_whose_port_answers_with_the_same_pid_means_already_serving() {
    let home = board_home();
    let (port, fake) = fake_health_server(2);
    write_serve_json(home.path(), &info(2, port));
    let error = Running::start(home.path(), 0).err().unwrap();
    assert_eq!(error, SkanError::AlreadyServing { port });
    fake.join().unwrap();
}

#[test]
fn a_broken_serve_json_is_overwritten() {
    let home = board_home();
    std::fs::write(home.path().join("serve.json"), "not json").unwrap();
    let server = Running::start(home.path(), 0).unwrap();
    assert_eq!(serve_json(home.path()).unwrap().port, server.port());
}

#[test]
fn stopping_leaves_a_serve_json_that_another_process_took_over() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    write_serve_json(home.path(), &info(1, 1));
    server.stop().unwrap();
    assert_eq!(serve_json(home.path()), Some(info(1, 1)));
}

// ---------------------------------------------------------------- CLI notification end to end

#[test]
fn notify_serve_from_the_cli_side_reaches_connected_browsers() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut events = server.events();
    let notified = with_home(home.path(), skan::interact::notify::notify_serve);
    assert!(notified);
    events.wait_for("event: changed\ndata: {}\n\n", Duration::from_secs(2));
}

#[test]
fn notify_serve_is_false_after_the_server_stopped() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let port = server.port();
    server.stop().unwrap();
    // serve.json is gone, and a leftover one pointing at the closed port fails too.
    assert!(!with_home(
        home.path(),
        skan::interact::notify::notify_serve
    ));
    write_serve_json(home.path(), &info(std::process::id(), port));
    assert!(!with_home(
        home.path(),
        skan::interact::notify::notify_serve
    ));
}
