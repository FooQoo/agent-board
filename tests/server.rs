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
    // The script writes its chunk table into OUT_DIR: point it at a scratch
    // folder, so the real build's table is never overwritten.
    Command::new(&exe)
        .env("CARGO_MANIFEST_DIR", manifest_dir)
        .env("OUT_DIR", scratch.path())
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
fn build_script_stops_the_build_when_the_white_logo_is_missing() {
    let dir = fake_manifest(&["index.html", "assets/app.js", "assets/app.css", "logo.png"]);
    let out = run_build_script(dir.path());
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("logo-white.png"), "{stderr}");
    assert!(
        stderr.contains("Run \"pnpm --dir web build\" first."),
        "{stderr}"
    );
}

#[test]
fn build_script_passes_and_watches_the_dist_directory_when_built() {
    let dir = fake_manifest(&[
        "index.html",
        "assets/app.js",
        "assets/app.css",
        "logo.png",
        "logo-white.png",
        "access/index.html",
        "access/entry.js",
        "monitor/index.html",
        "monitor/monitor.js",
        "monitor/monitor.css",
    ]);
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

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::server::{ServeConfig, run_until};
use chrono::{DateTime, TimeZone, Utc};

// AGBOARD_HOME is process-global. It is only needed while a server starts (the
// server captures its paths then), so the lock is released once it is ready.
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

fn t(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, minute, 0).unwrap()
}

fn store_in(home: &Path) -> FileStore {
    FileStore::open(&home.join("shared"))
}

/// A TASK.md body that the file store accepts.
const BODY: &str =
    "---\nacceptance:\n  - id: AC-1\n    text: Done\n    done: false\n---\n\nSome details\n";

/// The ID of the project named "main" in the data directory `home`.
fn main_id(home: &Path) -> ProjectId {
    store_in(home).project_by_name("main").unwrap().id
}

/// A temporary board with one user card and two AI cards in distinct states.
fn board_home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let store = store_in(home.path());
    let main = store.create_project("main", t(0)).unwrap().id;
    let add = |title: &str, assignee| {
        store
            .create_card(
                &main,
                NewCard {
                    title: title.into(),
                    description: BODY.into(),
                    assignee,
                    actor: match assignee {
                        Assignee::Ai => Actor::Ai,
                        Assignee::Human => Actor::Human,
                    },
                    is_draft: false,
                },
                t(1),
            )
            .unwrap()
    };
    let _first = add("First card", Assignee::Human);
    let second = add("Second card", Assignee::Ai);
    let third = add("Third card", Assignee::Ai);
    let context = |reason: &str| ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    };
    store
        .move_work_card(&main, second.id, Column::Doing, context("Start"), t(4))
        .unwrap();
    store
        .move_work_card(&main, third.id, Column::Doing, context("Start"), t(5))
        .unwrap();
    store
        .set_agent_status(
            &main,
            second.id,
            RunState::Running,
            context("Inspect"),
            None,
            t(6),
        )
        .unwrap();
    store
        .request_decision(
            &main,
            third.id,
            agent_board::domain::Actor::Ai,
            "Waiting for review",
            two_choices(),
            t(7),
        )
        .unwrap();
    home
}

fn card_ids(home: &Path) -> Vec<i64> {
    let mut ids: Vec<i64> = store_in(home)
        .board(&main_id(home))
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
    /// `/api/projects/<id of "main">`, or empty when the data has no such project.
    base: String,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
}

impl Running {
    /// Start a server for the data directory `home` on `port` (0 = any) and
    /// wait until it is ready, or return the error it stopped with.
    fn start(home: &Path, port: u16) -> Result<Running, AgboardError> {
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
                    base: FileStore::open(&home.join("shared"))
                        .project_by_name("main")
                        .map(|project| format!("/api/projects/{}", project.id))
                        .unwrap_or_default(),
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

    /// A path below the "main" project's API.
    fn api(&self, rest: &str) -> String {
        format!("{}{rest}", self.base)
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    /// The headers a page served by this server sends for a delete.
    fn page_headers(&self, token: &str) -> Vec<(String, String)> {
        vec![
            ("Origin".into(), format!("http://127.0.0.1:{}", self.port())),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
            ("X-Agboard-Token".into(), token.into()),
        ]
    }

    /// Fetch the session token the way a browser would, from `GET /`.
    fn token(&self) -> String {
        let page = self.get("/");
        let marker = "name=\"agboard-token\" content=\"";
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

    fn send_json(&self, method: &str, path: &str, body: &str, token: Option<&str>) -> Reply {
        let mut builder = ureq::http::Request::builder()
            .method(method)
            .uri(self.url(path))
            .header("Content-Type", "application/json");
        if let Some(token) = token {
            for (name, value) in self.page_headers(token) {
                builder = builder.header(name, value);
            }
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .build()
            .into();
        let mut response = agent.run(builder.body(body.to_string()).unwrap()).unwrap();
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .map(|v| v.to_str().unwrap().to_string());
        let cache_control = response
            .headers()
            .get("cache-control")
            .map(|v| v.to_str().unwrap().to_string());
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
        self.send_owned("DELETE", &self.api(&format!("/cards/{id}")), &headers)
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

    fn stop(mut self) -> Result<(), AgboardError> {
        self.shutdown()
    }

    fn shutdown(&mut self) -> Result<(), AgboardError> {
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
    assert!(!page.body.contains("{{AGBOARD_TOKEN}}"));
    let token = server.token();
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
    assert!(page.body.contains(&format!(
        "<meta name=\"agboard-token\" content=\"{token}\" />"
    )));
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

    let logo = server.get("/logo.png");
    assert_eq!(logo.status, 200);
    assert_eq!(logo.content_type.as_deref(), Some("image/png"));
    assert_eq!(logo.cache_control.as_deref(), Some("no-store"));
    let logo_bytes = ureq::get(server.url("/logo.png"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_vec()
        .unwrap();
    assert_eq!(
        logo_bytes,
        std::fs::read(dist.parent().unwrap().join("logo.png")).unwrap()
    );

    let white = server.get("/logo-white.png");
    assert_eq!(white.status, 200);
    assert_eq!(white.content_type.as_deref(), Some("image/png"));
    assert_eq!(white.cache_control.as_deref(), Some("no-store"));
    let white_bytes = ureq::get(server.url("/logo-white.png"))
        .call()
        .unwrap()
        .body_mut()
        .read_to_vec()
        .unwrap();
    assert_eq!(
        white_bytes,
        std::fs::read(dist.parent().unwrap().join("logo-white.png")).unwrap()
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
    let reply = server.get(&server.api("/board"));
    assert_eq!(reply.status, 200);
    assert_eq!(reply.content_type.as_deref(), Some("application/json"));

    let snapshot = store_in(home.path()).board(&main_id(home.path())).unwrap();
    let expected = serde_json::json!({
        "project": {
            "id": snapshot.project.id.to_string(),
            "name": "main",
            "createdAt": "2026-10-02T01:00:00Z",
        },
        "version": snapshot.version,
        "cursor": snapshot.cursor.to_string(),
        "epics": [],
        "cards": serde_json::to_value(&snapshot.cards).unwrap(),
        "problems": [],
    });
    let actual: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(actual["cards"].as_array().unwrap().len(), 3);

    // The documented key order, at the board and at each card.
    assert_eq!(actual["version"], snapshot.version);
    assert_eq!(actual["cards"][2]["pendingReason"], "Waiting for review");
}

#[test]
fn board_reflects_changes_made_after_the_server_started() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    store_in(home.path())
        .create_card(
            &main_id(home.path()),
            NewCard {
                title: "Late card".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            t(10),
        )
        .unwrap();
    // A save made outside the server is seen after the watcher's short quiet
    // period (AC-3), so the read waits for it instead of assuming it.
    let deadline = Instant::now() + Duration::from_secs(3);
    let actual = loop {
        let actual: serde_json::Value =
            serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
        if actual["cards"].as_array().unwrap().len() == 4 || Instant::now() > deadline {
            break actual;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(actual["cards"].as_array().unwrap().len(), 4);
}

#[test]
fn protected_api_creates_moves_requests_and_answers_with_full_history() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let mut events = server.events();
    let denied = server.send_json(
        "POST",
        &server.api("/cards"),
        r#"{"title":"Denied","description":"","assignee":"ai","actor":"ai"}"#,
        None,
    );
    assert_eq!(denied.status, 403);
    let token = server.token();
    let created = server.send_json(
        "POST",
        &server.api("/cards"),
        r#"{"title":"New work","description":"","assignee":"ai","actor":"ai"}"#,
        Some(&token),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    let moved = server.send_json(
        "POST",
        &server.api("/cards/4/move"),
        r#"{"cardStatus":"doing","actor":"ai","reason":"Start"}"#,
        Some(&token),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let pending = server.send_json(
        "POST",
        &server.api("/cards/4/agent-status"),
        r#"{"agentStatus":"pending","actor":"ai","reason":"Need direction","choices":[{"id":"a","label":"Plan A"},{"id":"b","label":"Plan B"}]}"#,
        Some(&token),
    );
    assert_eq!(pending.status, 200, "{}", pending.body);
    let no_choices = server.send_json(
        "POST",
        &server.api("/cards/4/agent-status"),
        r#"{"agentStatus":"pending","actor":"ai","reason":"A question with no choices"}"#,
        Some(&token),
    );
    assert_eq!(no_choices.status, 200, "{}", no_choices.body);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&no_choices.body).unwrap()["changed"],
        false
    );
    let request: serde_json::Value = serde_json::from_str(&pending.body).unwrap();
    let request_id = request["card"]["pendingRequestId"].as_str().unwrap();
    let body = serde_json::json!({"requestId":request_id,"actor":"human","text":"Proceed with A"})
        .to_string();
    let answered = server.send_json("POST", &server.api("/cards/4/answer"), &body, Some(&token));
    assert_eq!(answered.status, 200, "{}", answered.body);
    let board: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
    assert_eq!(board["cards"][3]["agentStatus"], "idle");
    assert_eq!(board["cards"][3]["history"].as_array().unwrap().len(), 4);
    assert!(events.try_wait_for("event: changed", Duration::from_secs(1)));
}

#[test]
fn archive_api_has_separate_reads_bulk_operation_restore_and_delete_guard() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let mut events = server.events();

    let archived = server.send_json("POST", &server.api("/cards/1/archive"), "", Some(&token));
    assert_eq!(archived.status, 200, "{}", archived.body);
    let card: serde_json::Value = serde_json::from_str(&archived.body).unwrap();
    assert!(card["card"]["archivedAt"].is_string());
    assert!(events.try_wait_for("event: changed", Duration::from_secs(1)));

    let board: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
    assert!(
        !board["cards"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == 1)
    );
    let archive: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/archive")).body).unwrap();
    assert_eq!(archive["cards"].as_array().unwrap().len(), 1);
    assert_eq!(archive["cards"][0]["id"], 1);

    let restored = server.send_json("POST", &server.api("/cards/1/restore"), "", Some(&token));
    assert_eq!(restored.status, 200, "{}", restored.body);
    assert!(restored.body.contains("\"archivedAt\":null"));

    let moved = server.send_json(
        "POST",
        &server.api("/cards/1/move"),
        r#"{"cardStatus":"done","reason":"Finish"}"#,
        Some(&token),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let bulk = server.send_json(
        "POST",
        &server.api("/cards/archive-done"),
        r#"{"ids":[1]}"#,
        Some(&token),
    );
    assert_eq!(bulk.status, 200, "{}", bulk.body);
    let body: serde_json::Value = serde_json::from_str(&bulk.body).unwrap();
    assert_eq!(body["archivedCount"], 1);

    let ordinary_delete = server.delete_as_page(2);
    assert_eq!(ordinary_delete.status, 409, "{}", ordinary_delete.body);
    let physical = server.delete_as_page(1);
    assert_eq!(physical.status, 204, "{}", physical.body);
    assert_eq!(server.get(&server.api("/archive")).status, 200);
    let archive: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/archive")).body).unwrap();
    assert!(archive["cards"].as_array().unwrap().is_empty());
}

/// Add a second project "other" that has a card with the same number as the
/// first card of "main", and return its ID.
fn add_other_project(home: &Path) -> ProjectId {
    let store = store_in(home);
    let other = store.create_project("other", t(0)).unwrap().id;
    store
        .create_card(
            &other,
            NewCard {
                title: "Other first".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            t(1),
        )
        .unwrap();
    other
}

#[test]
fn the_same_card_number_in_two_projects_never_mixes_through_the_api() {
    let home = board_home();
    let other = add_other_project(home.path());
    let main = main_id(home.path());
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let before_main = store_in(home.path()).board(&main).unwrap();

    let moved = server.send_json(
        "POST",
        &format!("/api/projects/{other}/cards/1/move"),
        r#"{"cardStatus":"doing","actor":"ai","reason":"Start"}"#,
        Some(&token),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let created = server.send_json(
        "POST",
        &format!("/api/projects/{other}/cards"),
        r#"{"title":"Second in other","description":"","assignee":"ai","actor":"ai"}"#,
        Some(&token),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    assert_eq!(store_in(home.path()).board(&main).unwrap(), before_main);

    let board: serde_json::Value =
        serde_json::from_str(&server.get(&format!("/api/projects/{other}/board")).body).unwrap();
    assert_eq!(board["project"]["name"], "other");
    assert_eq!(board["cards"].as_array().unwrap().len(), 2);
    assert_eq!(board["cards"][0]["cardStatus"], "doing");

    // Card #3 exists only in "main": it cannot be reached through "other".
    let headers = server.page_headers(&token);
    let reply = server.send_owned(
        "DELETE",
        &format!("/api/projects/{other}/cards/3"),
        &headers,
    );
    assert_eq!(reply.status, 404);
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
    let archived = server.send_json("POST", &server.api("/cards/3/archive"), "", Some(&token));
    assert_eq!(archived.status, 200, "{}", archived.body);
    let reply = server.send_owned("DELETE", &server.api("/cards/3"), &headers);
    assert_eq!(reply.status, 204);
    assert_eq!(card_ids(home.path()), vec![1, 2]);
}

#[test]
fn a_project_that_does_not_exist_or_is_malformed_is_refused_before_any_change() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let ghost = ProjectId::generate().unwrap();
    let before = store_in(home.path()).board(&main_id(home.path())).unwrap();

    let reply = server.send_json(
        "POST",
        &format!("/api/projects/{ghost}/cards"),
        r#"{"title":"Nowhere","description":"","assignee":"ai","actor":"ai"}"#,
        Some(&token),
    );
    assert_eq!(reply.status, 404, "{}", reply.body);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(body["error"]["code"], "project_not_found");

    let reply = server.send_json(
        "POST",
        "/api/projects/not-an-id/cards",
        r#"{"title":"Nowhere","description":"","assignee":"ai","actor":"ai"}"#,
        Some(&token),
    );
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(server.get("/api/projects/not-an-id/board").status, 422);
    // The guard still comes first: no token, no existence check.
    let reply = server.send_json(
        "POST",
        &format!("/api/projects/{ghost}/cards"),
        r#"{"title":"Nowhere","description":"","assignee":"ai","actor":"ai"}"#,
        None,
    );
    assert_eq!(reply.status, 403);
    assert_eq!(
        store_in(home.path()).board(&main_id(home.path())).unwrap(),
        before
    );
}

#[test]
fn the_old_target_less_card_routes_do_not_exist() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    assert_eq!(server.get("/api/board").status, 404);
    let reply = server.send_json(
        "POST",
        "/api/cards",
        r#"{"title":"Old","description":"","assignee":"ai","actor":"ai"}"#,
        Some(&token),
    );
    assert_eq!(reply.status, 404);
    let headers = server.page_headers(&token);
    assert_eq!(
        server.send_owned("DELETE", "/api/cards/1", &headers).status,
        404
    );
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
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
    // A write-method request is guarded before the route is even matched.
    assert_eq!(server.send("POST", &server.api("/board"), &[]).status, 403);
    let headers = server.page_headers(&server.token());
    assert_eq!(
        server
            .send_owned("POST", &server.api("/board"), &headers)
            .status,
        405
    );
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
    let board = server.api("/board");
    let card = server.api("/cards/1");
    let requests = [
        ("GET", "/"),
        ("GET", "/assets/app.js"),
        ("GET", "/assets/app.css"),
        ("GET", board.as_str()),
        ("GET", "/api/events"),
        ("GET", "/api/health"),
        ("POST", "/api/notify"),
        ("DELETE", card.as_str()),
        ("GET", "/nope"),
        ("POST", board.as_str()),
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
    write!(stream, "GET {} HTTP/1.0\r\n\r\n", server.api("/board")).unwrap();
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
    let archive = server.send_json(
        "POST",
        &server.api("/cards/2/archive"),
        "",
        Some(&server.token()),
    );
    assert_eq!(archive.status, 200, "{}", archive.body);
    let reply = server.delete_as_page(2);
    assert_eq!(reply.status, 204);
    assert_eq!(reply.body, "");
    assert_eq!(card_ids(home.path()), vec![1, 3]);
    let board: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
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
    let archived = server.send_json("POST", &server.api("/cards/1/archive"), "", Some(&token));
    assert_eq!(archived.status, 200, "{}", archived.body);
    let reply = server.send(
        "DELETE",
        &server.api("/cards/1"),
        &[
            ("Host", host.as_str()),
            ("Origin", origin.as_str()),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", token.as_str()),
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
            headers.push(("X-Agboard-Token", v));
        }
        let reply = server.send("DELETE", &server.api("/cards/1"), &headers);
        assert_eq!(reply.status, 403, "{name}");
        let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        // A token that is present but wrong comes from an earlier server: the page asks for a reload. Anything
        // else is simply forbidden. Both are refused, and nothing is deleted.
        let expected = if name == "wrong token" || name == "short token" {
            "page_out_of_date"
        } else {
            "forbidden"
        };
        assert_eq!(body["error"]["code"], expected, "{name}");
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
        &server.api(&format!("/cards/1?token={token}")),
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
            "reason": "No card has ID 99. Run \"agboard ls\" to see the cards.",
        }})
    );
    for bad_id in ["abc", "0", "-1", "1.5"] {
        let headers = server.page_headers(&server.token());
        let reply = server.send_owned("DELETE", &server.api(&format!("/cards/{bad_id}")), &headers);
        assert_eq!(reply.status, 404, "{bad_id}");
    }
    assert_eq!(card_ids(home.path()), vec![1, 2, 3]);
}

#[test]
fn the_guard_runs_before_the_existence_check() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    assert_eq!(
        server.send("DELETE", &server.api("/cards/99"), &[]).status,
        403
    );
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
    store_in(home.path())
        .create_card(
            &main_id(home.path()),
            NewCard {
                title: "Notified".into(),
                description: BODY.into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            t(12),
        )
        .unwrap();
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
        store_in(home.path())
            .create_card(
                &main_id(home.path()),
                NewCard {
                    title: format!("Notified {n}"),
                    description: BODY.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                t(12),
            )
            .unwrap();
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
    assert_eq!(
        server.send("DELETE", &server.api("/cards/1"), &[]).status,
        403
    );
    assert_eq!(server.delete_as_page(99).status, 404);
    assert!(
        !events.try_wait_for("event: changed", Duration::from_millis(300)),
        "{}",
        events.received
    );
    let archive = server.send_json(
        "POST",
        &server.api("/cards/1/archive"),
        "",
        Some(&server.token()),
    );
    assert_eq!(archive.status, 200, "{}", archive.body);
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

use agent_board::paths::ServeInfo;

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
        agent_board::clock::parse_utc(&written.started_at).is_ok(),
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
fn a_new_data_area_is_served_with_no_projects_and_unknown_projects_are_404() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path(), 0).unwrap();
    assert!(home.path().join("serve.json").exists());
    let ghost = ProjectId::generate().unwrap();
    let reply = server.get(&format!("/api/projects/{ghost}/board"));
    assert_eq!(reply.status, 404);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(body["error"]["code"], "project_not_found");
    server.stop().unwrap();
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn a_second_server_for_the_same_data_directory_is_already_serving() {
    let home = board_home();
    let first = Running::start(home.path(), 0).unwrap();
    let before = serve_json(home.path());
    let error = Running::start(home.path(), 0).err().unwrap();
    assert_eq!(error, AgboardError::AlreadyServing { port: first.port() });
    // The first server is untouched.
    assert_eq!(serve_json(home.path()), before);
    assert_eq!(first.get("/api/health").status, 200);
    // Asking for the running server's own port is also "already serving".
    let error = Running::start(home.path(), first.port()).err().unwrap();
    assert_eq!(error, AgboardError::AlreadyServing { port: first.port() });
    first.stop().unwrap();
}

#[test]
fn a_port_in_use_by_something_else_is_port_in_use() {
    let home = board_home();
    let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = blocker.local_addr().unwrap().port();
    let error = Running::start(home.path(), port).err().unwrap();
    assert_eq!(error, AgboardError::PortInUse { port });
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
    assert_eq!(error, AgboardError::AlreadyServing { port });
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
    store_in(home.path())
        .create_card(
            &main_id(home.path()),
            NewCard {
                title: "From the CLI side".into(),
                description: BODY.into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            t(12),
        )
        .unwrap();
    let notified = with_home(home.path(), agent_board::interact::notify::notify_serve);
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
        agent_board::interact::notify::notify_serve
    ));
    write_serve_json(home.path(), &info(std::process::id(), port));
    assert!(!with_home(
        home.path(),
        agent_board::interact::notify::notify_serve
    ));
}

// ---------------------------------------------------------------- examples/serve.rs and `run`

use std::process::{Child, Stdio};

/// Path of the built `serve` example, building it first if needed (a plain
/// `cargo test --test server` does not build examples).
fn serve_example() -> std::path::PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let built = Command::new(cargo)
        .args(["build", "--example", "serve"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status()
        .unwrap();
    assert!(built.success());
    let mut dir = std::env::current_exe().unwrap();
    dir.pop(); // deps/
    dir.pop(); // debug/
    dir.join("examples")
        .join(if cfg!(windows) { "serve.exe" } else { "serve" })
}

fn spawn_example(home: &Path, args: &[&str]) -> Child {
    Command::new(serve_example())
        .args(args)
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn wait_for_file(path: &Path, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    path.exists()
}

fn wait_for_exit(child: &mut Child, within: Duration) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().unwrap() {
            return Some(status);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    child.try_wait().unwrap()
}

/// Start the example on `port`, check it serves, send `signal`, and check it
/// exits cleanly and removes serve.json.
fn example_stops_on(signal: &str, port: u16) {
    let home = board_home();
    let mut child = spawn_example(home.path(), &["--port", &port.to_string()]);
    let serve_path = home.path().join("serve.json");
    assert!(
        wait_for_file(&serve_path, Duration::from_secs(5)),
        "serve.json never appeared"
    );
    let health = ureq::get(format!("http://127.0.0.1:{port}/api/health"))
        .call()
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
    assert_eq!(serve_json(home.path()).unwrap().port, port);

    let sent = Command::new("kill")
        .args([signal, &child.id().to_string()])
        .status()
        .unwrap();
    assert!(sent.success());
    let status = wait_for_exit(&mut child, Duration::from_secs(5));
    if status.is_none() {
        let _ = child.kill();
        let _ = child.wait();
    }
    assert_eq!(status.and_then(|s| s.code()), Some(0));
    assert!(!serve_path.exists(), "serve.json was left behind");
}

#[test]
#[cfg(unix)]
fn the_example_serves_and_cleans_up_on_sigint() {
    example_stops_on("-INT", 7941);
}

#[test]
#[cfg(unix)]
fn the_example_serves_and_cleans_up_on_sigterm() {
    example_stops_on("-TERM", 7942);
}

#[test]
fn the_example_reports_an_unusable_shared_folder_with_exit_code_1() {
    let home = tempfile::tempdir().unwrap();
    // A file where the shared folder should be is not a folder of projects.
    std::fs::write(home.path().join("shared"), b"not a folder").unwrap();
    let mut child = spawn_example(home.path(), &["--port", "7940"]);
    let status = wait_for_exit(&mut child, Duration::from_secs(5)).expect("it should exit");
    assert_eq!(status.code(), Some(1));
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(stderr.contains("Error: "), "{stderr}");
}

#[test]
fn the_example_reports_a_port_in_use_with_exit_code_1() {
    let home = board_home();
    let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = blocker.local_addr().unwrap().port();
    let mut child = spawn_example(home.path(), &["--port", &port.to_string()]);
    let status = wait_for_exit(&mut child, Duration::from_secs(5)).expect("it should exit");
    assert_eq!(status.code(), Some(1));
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(
        stderr.contains(&format!("Error: port {port} is already in use.")),
        "{stderr}"
    );
}

#[test]
fn the_example_needs_a_port() {
    let home = board_home();
    let mut child = spawn_example(home.path(), &[]);
    let status = wait_for_exit(&mut child, Duration::from_secs(5)).expect("it should exit");
    assert_eq!(status.code(), Some(2));
    assert!(!home.path().join("serve.json").exists());
}

// ---------------------------------------------------------------- shared-file checks

/// Read `/board` until `done` holds or three seconds pass. A save made outside
/// the server reaches the board after the watcher's short quiet period (AC-3).
fn board_until(server: &Running, done: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let board: serde_json::Value =
            serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
        if done(&board) || Instant::now() > deadline {
            return board;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// The error code of a JSON error body.
fn error_code_of(body: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(body).unwrap();
    value["error"]["code"].as_str().unwrap().to_string()
}

#[test]
fn a_task_md_with_a_missing_heading_is_reported_in_problems_until_it_is_fixed() {
    let home = board_home();
    let project = main_id(home.path());
    let server = Running::start(home.path(), 0).unwrap();
    let md = home
        .path()
        .join("shared/projects")
        .join(project.as_str())
        .join("tasks/1/TASK.md");
    let label = format!("projects/{project}/tasks/1/TASK.md");
    // A condition has no `done` key: the file is still being written, or was edited by hand.
    let original = std::fs::read_to_string(&md).unwrap();
    let (_, history) = original.split_once("history:").unwrap();
    let defective = format!("---\nacceptance:\n  - id: AC-1\n    text: Done\nhistory:{history}");
    std::fs::write(&md, &defective).unwrap();

    let board = board_until(&server, |b| !b["problems"].as_array().unwrap().is_empty());
    let problems = board["problems"].as_array().unwrap();
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0]["file"], label);
    assert_eq!(problems[0]["field"], "acceptance[0].done");
    assert!(!problems[0]["reason"].as_str().unwrap().is_empty());
    // The card still shows the text as it was saved; the product does not rewrite it.
    let card = board["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == 1)
        .unwrap();
    assert_eq!(card["description"], defective);

    let parsed = agent_board::file_store::history::parse_task(
        &original,
        agent_board::file_store::history::ParseMode::Stored,
    );
    let input = agent_board::file_store::history::parse_task(
        BODY,
        agent_board::file_store::history::ParseMode::NewInput,
    );
    let fixed = agent_board::file_store::history::compose_task(
        BODY,
        &input.body,
        Some(&input.acceptance),
        &parsed.history,
    )
    .unwrap();
    std::fs::write(&md, fixed).unwrap();
    let board = board_until(&server, |b| b["problems"].as_array().unwrap().is_empty());
    assert!(board["problems"].as_array().unwrap().is_empty(), "{board}");
}

#[test]
fn the_board_lists_each_epic_with_its_fields_and_plan() {
    use agent_board::file_store::model::NewEpic;
    let home = board_home();
    let project = main_id(home.path());
    store_in(home.path())
        .create_epic(
            &project,
            NewEpic {
                id: "epic-1".into(),
                name: "First epic".into(),
                color: Some("#3366cc".into()),
                is_draft: false,
                plan: None,
            },
            t(12),
        )
        .unwrap();
    let server = Running::start(home.path(), 0).unwrap();
    let board = board_until(&server, |b| !b["epics"].as_array().unwrap().is_empty());
    let epics = board["epics"].as_array().unwrap();
    assert_eq!(epics.len(), 1, "{board}");
    let epic = &epics[0];
    assert_eq!(epic["id"], "EPIC-1");
    assert_eq!(epic["name"], "First epic");
    assert_eq!(epic["color"], "#3366CC");
    assert_eq!(epic["isDraft"], false);
    assert_eq!(
        epic["plan"],
        agent_board::file_store::validate::plan_template()
    );
    assert_eq!(epic["attachments"], serde_json::json!([]));
    assert!(epic["createdAt"].is_string() && epic["updatedAt"].is_string());
    let mut keys: Vec<&str> = epic
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "attachments",
            "body",
            "color",
            "createdAt",
            "id",
            "isDraft",
            "name",
            "plan",
            "priority",
            "priorityError",
            "updatedAt"
        ]
    );
}

#[test]
fn a_restarted_server_serves_the_same_cards_and_version() {
    let home = board_home();
    let first = Running::start(home.path(), 0).unwrap();
    let before: serde_json::Value =
        serde_json::from_str(&first.get(&first.api("/board")).body).unwrap();
    first.stop().unwrap();
    assert!(!home.path().join("serve.json").exists());

    let second = Running::start(home.path(), 0).unwrap();
    let after: serde_json::Value =
        serde_json::from_str(&second.get(&second.api("/board")).body).unwrap();
    assert_eq!(after["version"], before["version"]);
    assert_eq!(after["cursor"], before["cursor"]);
    assert_eq!(after["cards"], before["cards"]);
    assert_eq!(after["cards"].as_array().unwrap().len(), 3);
}

#[test]
fn archive_done_refuses_empty_and_repeated_lists_and_changed_targets_and_resends_are_idempotent() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let token = server.token();
    let bulk = |body: &str| {
        server.send_json(
            "POST",
            &server.api("/cards/archive-done"),
            body,
            Some(&token),
        )
    };

    let empty = bulk(r#"{"ids":[]}"#);
    assert_eq!(empty.status, 422, "{}", empty.body);
    assert_eq!(error_code_of(&empty.body), "invalid_value");
    let repeated = bulk(r#"{"ids":[1,1]}"#);
    assert_eq!(repeated.status, 422, "{}", repeated.body);
    assert_eq!(error_code_of(&repeated.body), "invalid_value");

    // Card 1 is in Todo, so it is not a target: nothing is archived.
    let not_done = bulk(r#"{"ids":[1]}"#);
    assert_eq!(not_done.status, 409, "{}", not_done.body);
    assert_eq!(error_code_of(&not_done.body), "archive_targets_changed");
    let board: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
    assert_eq!(board["cards"].as_array().unwrap().len(), 3);

    let moved = server.send_json(
        "POST",
        &server.api("/cards/1/move"),
        r#"{"cardStatus":"done","reason":"Finish"}"#,
        Some(&token),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    // A target that does not exist is a changed target too, and the others stay as they were.
    let missing = bulk(r#"{"ids":[1,99]}"#);
    assert_eq!(missing.status, 409, "{}", missing.body);
    assert_eq!(error_code_of(&missing.body), "archive_targets_changed");
    let archive: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/archive")).body).unwrap();
    assert!(archive["cards"].as_array().unwrap().is_empty());

    let done = bulk(r#"{"ids":[1]}"#);
    assert_eq!(done.status, 200, "{}", done.body);
    let body: serde_json::Value = serde_json::from_str(&done.body).unwrap();
    assert_eq!(body["archivedCount"], 1);
    assert!(body["cards"][0]["archivedAt"].is_string());

    // A resend of the same bulk archive archives nothing and answers the same cards.
    let again = bulk(r#"{"ids":[1]}"#);
    assert_eq!(again.status, 200, "{}", again.body);
    let body: serde_json::Value = serde_json::from_str(&again.body).unwrap();
    assert_eq!(body["archivedCount"], 0);
    assert!(body["cards"][0]["archivedAt"].is_string());
}

fn two_choices() -> Vec<agent_board::file_store::model::Choice> {
    vec![
        agent_board::file_store::model::Choice {
            id: "a".into(),
            label: "Plan A".into(),
        },
        agent_board::file_store::model::Choice {
            id: "b".into(),
            label: "Plan B".into(),
        },
    ]
}

#[test]
fn a_write_with_a_token_from_an_earlier_server_asks_for_a_reload() {
    let home = board_home();
    let server = Running::start(home.path(), 0).unwrap();
    let body = r#"{"title":"Stale","description":"","assignee":"ai","actor":"ai"}"#;
    let stale = server.send_json(
        "POST",
        &server.api("/cards"),
        body,
        Some("an-earlier-token"),
    );
    assert_eq!(stale.status, 403, "{}", stale.body);
    assert!(
        stale.body.contains("\"page_out_of_date\""),
        "{}",
        stale.body
    );
    let missing = server.send_json("POST", &server.api("/cards"), body, None);
    assert_eq!(missing.status, 403, "{}", missing.body);
    assert!(missing.body.contains("\"forbidden\""), "{}", missing.body);
    let board: serde_json::Value =
        serde_json::from_str(&server.get(&server.api("/board")).body).unwrap();
    assert!(
        board["cards"]
            .as_array()
            .unwrap()
            .iter()
            .all(|card| card["title"] != "Stale")
    );
}
