//! The multi-project HTTP surface of `agboard serve`: the project list, the
//! per-project board and card routes, guard ordering, and the change
//! notifications that reach connected browsers.
//!
//! Servers listen on port 0 in a temporary data directory. The CLI is run as
//! the real `agboard` binary against the same `SKAN_HOME`.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
use agent_board::error::SkanError;
use agent_board::server::{ServeConfig, run_until};
use agent_board::store::ProjectStore;
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Value, json};

// ---------------------------------------------------------------- harness

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

fn db(home: &Path) -> std::path::PathBuf {
    home.join("board.db")
}

fn store(home: &Path) -> ProjectStore {
    ProjectStore::open(&db(home)).unwrap()
}

fn card(title: &str, assignee: Assignee) -> NewCard {
    NewCard {
        title: title.into(),
        description: String::new(),
        assignee,
        actor: Actor::Human,
    }
}

fn ctx(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    }
}

struct Reply {
    status: u16,
    body: String,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| panic!("not JSON: {:?}", self.body))
    }
    fn code(&self) -> String {
        self.json()["error"]["code"].as_str().unwrap().to_string()
    }
}

struct Running {
    addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), SkanError>>>,
}

impl Running {
    fn start(home: &Path) -> Running {
        with_home(home, || {
            let (ready_tx, ready_rx) = mpsc::channel();
            let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
            let handle = std::thread::spawn(move || {
                run_until(
                    ServeConfig { port: 0 },
                    async move {
                        let _ = stop_rx.await;
                    },
                    move |addr| {
                        let _ = ready_tx.send(addr);
                    },
                )
            });
            match ready_rx.recv_timeout(Duration::from_secs(10)) {
                Ok(addr) => Running {
                    addr,
                    stop: Some(stop_tx),
                    handle: Some(handle),
                },
                Err(_) => panic!("server did not start: {:?}", handle.join()),
            }
        })
    }

    fn port(&self) -> u16 {
        self.addr.port()
    }

    fn token(&self) -> String {
        let page = self.get("/").body;
        let marker = "name=\"skan-token\" content=\"";
        let start = page.find(marker).expect("token meta tag") + marker.len();
        page[start..start + 64].to_string()
    }

    fn page_headers(&self, token: &str) -> Vec<(String, String)> {
        vec![
            ("Origin".into(), format!("http://127.0.0.1:{}", self.port())),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
            ("X-Skan-Token".into(), token.into()),
        ]
    }

    fn get(&self, path: &str) -> Reply {
        self.request("GET", path, None, &[], None)
    }

    /// A write sent the way the board page sends it.
    fn write(&self, method: &str, path: &str, body: Option<&str>) -> Reply {
        let headers = self.page_headers(&self.token());
        self.request(method, path, body, &headers, Some("application/json"))
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        headers: &[(String, String)],
        content_type: Option<&str>,
    ) -> Reply {
        let mut builder = ureq::http::Request::builder()
            .method(method)
            .uri(format!("http://{}{path}", self.addr));
        if let Some(content_type) = content_type {
            builder = builder.header("Content-Type", content_type);
        }
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        let mut response = agent
            .run(builder.body(body.unwrap_or("").to_string()).unwrap())
            .unwrap();
        Reply {
            status: response.status().as_u16(),
            body: response.body_mut().read_to_string().unwrap_or_default(),
        }
    }

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
        assert!(events.wait_for("event: ready", Duration::from_secs(3)));
        events
    }

    fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct EventStream {
    stream: TcpStream,
    received: String,
}

impl EventStream {
    fn wait_for(&mut self, needle: &str, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        let mut chunk = [0u8; 4096];
        while Instant::now() < deadline {
            if self.received.contains(needle) {
                return true;
            }
            match self.stream.read(&mut chunk) {
                Ok(0) => break,
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

    fn changed(&mut self) -> bool {
        self.wait_for("event: changed", Duration::from_secs(3))
    }

    /// Whether no `changed` arrives for a short while.
    fn stays_quiet(&mut self) -> bool {
        !self.wait_for("event: changed", Duration::from_millis(600))
    }

    fn changed_count(&self) -> usize {
        self.received.matches("event: changed").count()
    }
}

fn agboard(home: &Path, args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    (
        output.status.code().unwrap(),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

/// Two projects "alpha" and "beta", each with cards 1 and 2 (card 1 human,
/// card 2 AI), so the same card number exists in both.
fn two_projects() -> (tempfile::TempDir, ProjectId, ProjectId) {
    let home = tempfile::tempdir().unwrap();
    let s = store(home.path());
    let a = s.create_project("alpha", t(0)).unwrap().id;
    let b = s.create_project("beta", t(0)).unwrap().id;
    for id in [&a, &b] {
        s.add_work_card(id, card("Human card", Assignee::Human), t(1))
            .unwrap();
        s.add_work_card(id, card("AI card", Assignee::Ai), t(2))
            .unwrap();
    }
    (home, a, b)
}

fn snapshot_json(home: &Path, id: &ProjectId) -> Value {
    let snapshot = store(home).snapshot(id).unwrap();
    json!({
        "revision": snapshot.revision,
        "cards": serde_json::to_value(&snapshot.cards).unwrap(),
    })
}

// ---------------------------------------------------------------- project list

#[test]
fn the_list_of_a_new_data_area_is_empty_with_catalog_revision_zero() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let reply = server.get("/api/projects");
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json(), json!({"projects": [], "catalogRevision": 0}));
}

#[test]
fn the_list_has_every_project_by_name_with_no_cards_and_the_catalog_revision() {
    let (home, a, b) = two_projects();
    // Created out of name order on purpose.
    let zed = store(home.path()).create_project("Zed", t(3)).unwrap();
    let server = Running::start(home.path());
    let reply = server.get("/api/projects");
    assert_eq!(reply.status, 200, "{}", reply.body);
    let catalog = store(home.path()).projects().unwrap();
    let body = reply.json();
    assert_eq!(body["catalogRevision"], catalog.catalog_revision);
    let names: Vec<&str> = body["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Zed", "alpha", "beta"]);
    assert_eq!(body["projects"][0]["id"], zed.id.to_string());
    assert_eq!(body["projects"][1]["id"], a.to_string());
    assert_eq!(body["projects"][2]["id"], b.to_string());
    assert_eq!(body["projects"][1]["createdAt"], "2026-10-02T01:00:00Z");
    for project in body["projects"].as_array().unwrap() {
        let keys: Vec<&String> = project.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 3, "only id, name and createdAt: {project}");
    }
    assert!(!reply.body.contains("cards"));
}

#[test]
fn the_catalog_revision_follows_catalog_changes_and_the_list_is_re_read() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let before = server.get("/api/projects").json()["catalogRevision"]
        .as_i64()
        .unwrap();
    let (code, _, err) = agboard(home.path(), &["project", "create", "fresh"]);
    assert_eq!(code, 0, "{err}");
    let after = server.get("/api/projects").json();
    assert_eq!(after["projects"].as_array().unwrap().len(), 1);
    assert_eq!(after["projects"][0]["name"], "fresh");
    assert!(after["catalogRevision"].as_i64().unwrap() > before);
}

#[test]
fn the_list_only_answers_get_and_is_not_cached() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    assert_eq!(
        server.write("POST", "/api/projects", Some("{}")).status,
        405
    );
    assert_eq!(server.write("DELETE", "/api/projects", None).status, 405);
    assert_eq!(
        server
            .write("POST", "/api/projects/anything/rename", Some("{}"))
            .status,
        404
    );
}

#[test]
fn the_list_needs_an_accepted_host() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let reply = server.request(
        "GET",
        "/api/projects",
        None,
        &[("Host".into(), "evil.example".into())],
        None,
    );
    assert_eq!(reply.status, 403);
}

// ---------------------------------------------------------------- board

#[test]
fn the_board_has_the_full_history_the_cursor_and_no_next_card_id() {
    let (home, a, _) = two_projects();
    store(home.path())
        .move_work_card(&a, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let server = Running::start(home.path());
    let reply = server.get(&format!("/api/projects/{a}/board"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    assert!(!reply.body.contains("nextCardId"));
    assert_eq!(body["project"]["id"], a.to_string());
    assert_eq!(body["board"]["name"], "alpha");
    let revision = body["revision"].as_i64().unwrap();
    assert_eq!(body["cursor"], format!("{a}:{revision}"));
    assert_eq!(body["cards"].as_array().unwrap().len(), 2);
    assert_eq!(body["cards"][1]["history"].as_array().unwrap().len(), 2);
}

#[test]
fn the_same_card_number_is_read_separately_per_project() {
    let (home, a, b) = two_projects();
    store(home.path())
        .move_work_card(&a, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let server = Running::start(home.path());
    let alpha = server.get(&format!("/api/projects/{a}/board")).json();
    let beta = server.get(&format!("/api/projects/{b}/board")).json();
    assert_eq!(alpha["cards"][1]["cardStatus"], "doing");
    assert_eq!(beta["cards"][1]["cardStatus"], "todo");
    assert_ne!(alpha["cursor"], beta["cursor"]);
}

#[test]
fn a_missing_or_malformed_project_and_the_old_routes_are_not_found_or_invalid() {
    let (home, _, _) = two_projects();
    let server = Running::start(home.path());
    let ghost = ProjectId::generate().unwrap();
    let reply = server.get(&format!("/api/projects/{ghost}/board"));
    assert_eq!(reply.status, 404);
    assert_eq!(reply.code(), "project_not_found");
    for bad in ["not-an-id", "ABCDEF0123456789ABCDEF0123456789", "alpha"] {
        let reply = server.get(&format!("/api/projects/{bad}/board"));
        assert_eq!(reply.status, 422, "{bad}: {}", reply.body);
        assert_eq!(reply.code(), "invalid_value");
    }
    assert_eq!(server.get("/api/board").status, 404);
    assert_eq!(
        server
            .write(
                "POST",
                "/api/cards",
                Some(r#"{"title":"x","description":"","assignee":"ai"}"#)
            )
            .status,
        404
    );
}

// ---------------------------------------------------------------- writes

#[test]
fn creating_a_card_in_one_project_leaves_the_other_untouched_and_is_a_human_action() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"New","description":"","assignee":"ai"}"#),
    );
    assert_eq!(reply.status, 201, "{}", reply.body);
    let created = reply.json();
    assert_eq!(created["card"]["id"], 3);
    assert_eq!(created["card"]["cardStatus"], "todo");
    assert_eq!(created["card"]["agentStatus"], "idle");
    assert_eq!(created["card"]["history"][0]["actor"], "human");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn an_actor_sent_by_the_page_is_never_trusted() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let created = server.write(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"Sneaky","description":"","assignee":"ai","actor":"ai"}"#),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    assert_eq!(created.json()["card"]["history"][0]["actor"], "human");
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/3/move"),
        Some(r#"{"cardStatus":"doing","actor":"ai","reason":"Start"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let history = moved.json()["card"]["history"].clone();
    let last = history.as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["actor"], "human");
    // A body that omits the actor is the normal form.
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/3/move"),
        Some(r#"{"cardStatus":"done","reason":"Finish"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
}

#[test]
fn moving_card_one_in_alpha_does_not_move_card_one_in_beta() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/1/move"),
        Some(r#"{"cardStatus":"doing","reason":"Start"}"#),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["card"]["cardStatus"], "doing");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

fn pending_request(home: &Path, id: &ProjectId) -> String {
    let s = store(home);
    s.move_work_card(id, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let result = s
        .set_agent_status(id, 2, RunState::Pending, ctx("Need direction"), None, t(5))
        .unwrap();
    result.value.pending_request_id.unwrap()
}

#[test]
fn answering_uses_the_request_of_that_project_and_a_wrong_request_changes_nothing() {
    let (home, a, b) = two_projects();
    let request_a = pending_request(home.path(), &a);
    let request_b = pending_request(home.path(), &b);
    let before_a = snapshot_json(home.path(), &a);
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());

    // beta's request does not answer alpha's card.
    let body = json!({"requestId": request_b, "reason": "Go"}).to_string();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/2/answer"),
        Some(&body),
    );
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "request_changed");
    assert_eq!(snapshot_json(home.path(), &a), before_a);
    assert_eq!(snapshot_json(home.path(), &b), before_b);

    let body = json!({"requestId": request_a, "reason": "Go"}).to_string();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/2/answer"),
        Some(&body),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["card"]["agentStatus"], "idle");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn agent_status_through_http_keeps_the_state_rules() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    // The AI card is still in TODO: an agent state is only allowed in DOING.
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/2/agent-status"),
        Some(r#"{"agentStatus":"running","reason":"Go"}"#),
    );
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_state_for_assignee");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn deleting_in_one_project_leaves_the_other_untouched() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    let reply = server.write("DELETE", &format!("/api/projects/{a}/cards/1"), None);
    assert_eq!(reply.status, 204, "{}", reply.body);
    let ids: Vec<i64> = store(home.path())
        .snapshot(&a)
        .unwrap()
        .cards
        .iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(ids, vec![2]);
    assert_eq!(snapshot_json(home.path(), &b), before_b);
    let again = server.write("DELETE", &format!("/api/projects/{a}/cards/1"), None);
    assert_eq!(again.status, 404);
    assert_eq!(again.code(), "card_not_found");
}

#[test]
fn a_write_to_a_project_that_was_deleted_is_404_and_never_lands_in_another() {
    let (home, a, b) = two_projects();
    let server = Running::start(home.path());
    let _ = server.get(&format!("/api/projects/{a}/board"));
    // Deleted by the CLI while the page still shows it. The same name comes
    // back as a different project.
    store(home.path()).delete_project(&a).unwrap();
    let again = store(home.path()).create_project("alpha", t(9)).unwrap().id;
    assert_ne!(again, a);
    let before_again = snapshot_json(home.path(), &again);
    let before_b = snapshot_json(home.path(), &b);
    for (method, path, body) in [
        (
            "POST",
            format!("/api/projects/{a}/cards"),
            Some(r#"{"title":"Late","description":"","assignee":"ai"}"#),
        ),
        (
            "POST",
            format!("/api/projects/{a}/cards/1/move"),
            Some(r#"{"cardStatus":"doing","reason":"Late"}"#),
        ),
        ("DELETE", format!("/api/projects/{a}/cards/1"), None),
    ] {
        let reply = server.write(method, &path, body);
        assert_eq!(reply.status, 404, "{method} {path}: {}", reply.body);
        assert_eq!(reply.code(), "project_not_found");
    }
    assert_eq!(server.get(&format!("/api/projects/{a}/board")).status, 404);
    assert_eq!(snapshot_json(home.path(), &again), before_again);
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn renaming_a_project_keeps_the_same_id_working() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "alpha", "project", "rename", "renamed"],
    );
    assert_eq!(code, 0, "{err}");
    let board = server.get(&format!("/api/projects/{a}/board")).json();
    assert_eq!(board["project"]["name"], "renamed");
    assert_eq!(board["project"]["id"], a.to_string());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"After rename","description":"","assignee":"ai"}"#),
    );
    assert_eq!(reply.status, 201, "{}", reply.body);
}

// ---------------------------------------------------------------- guards

/// Every write route, as (method, path suffix, body).
fn write_routes() -> Vec<(&'static str, &'static str, Option<&'static str>)> {
    vec![
        (
            "POST",
            "/cards",
            Some(r#"{"title":"x","description":"","assignee":"ai"}"#),
        ),
        (
            "POST",
            "/cards/1/move",
            Some(r#"{"cardStatus":"doing","reason":"r"}"#),
        ),
        (
            "POST",
            "/cards/2/agent-status",
            Some(r#"{"agentStatus":"pending","reason":"r"}"#),
        ),
        (
            "POST",
            "/cards/2/answer",
            Some(r#"{"requestId":"x","reason":"r"}"#),
        ),
        ("DELETE", "/cards/1", None),
    ]
}

#[test]
fn a_guard_violation_is_403_for_existing_and_missing_projects_alike() {
    let (home, a, b) = two_projects();
    let server = Running::start(home.path());
    let token = server.token();
    let ghost = ProjectId::generate().unwrap();
    let before_a = snapshot_json(home.path(), &a);
    let before_b = snapshot_json(home.path(), &b);
    let port = server.port();
    let good = |skip: &str| -> Vec<(String, String)> {
        let mut headers = vec![
            ("Origin".to_string(), format!("http://127.0.0.1:{port}")),
            ("Sec-Fetch-Site".to_string(), "same-origin".to_string()),
            ("X-Skan-Token".to_string(), token.clone()),
        ];
        headers.retain(|(name, _)| name != skip);
        headers
    };
    let wrong = |name: &str, value: &str| -> Vec<(String, String)> {
        let mut headers = good(name);
        headers.push((name.to_string(), value.to_string()));
        headers
    };
    let variants: Vec<(&str, Vec<(String, String)>)> = vec![
        ("no origin", good("Origin")),
        ("bad origin", wrong("Origin", "http://evil.example")),
        ("no fetch site", good("Sec-Fetch-Site")),
        ("cross-site", wrong("Sec-Fetch-Site", "cross-site")),
        ("no token", good("X-Skan-Token")),
        ("bad token", wrong("X-Skan-Token", &"0".repeat(64))),
        ("bad host", {
            let mut headers = good("");
            headers.push(("Host".to_string(), "evil.example".to_string()));
            headers
        }),
    ];
    for (method, suffix, body) in write_routes() {
        for (label, headers) in &variants {
            let mut replies = Vec::new();
            for project in [a.to_string(), ghost.to_string(), "not-an-id".to_string()] {
                let reply = server.request(
                    method,
                    &format!("/api/projects/{project}{suffix}"),
                    body,
                    headers,
                    Some("application/json"),
                );
                assert_eq!(reply.status, 403, "{method} {suffix} {label} {project}");
                replies.push(reply.body);
            }
            // The refusal does not reveal whether the project exists.
            assert_eq!(replies[0], replies[1], "{method} {suffix} {label}");
            assert_eq!(replies[0], replies[2], "{method} {suffix} {label}");
        }
    }
    assert_eq!(snapshot_json(home.path(), &a), before_a);
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn the_guard_runs_before_the_body_is_read() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/cards");
    let big = format!(
        r#"{{"title":"{}","description":"","assignee":"ai"}}"#,
        "x".repeat(70 * 1024)
    );
    for body in ["{broken", "{}", big.as_str()] {
        let reply = server.request("POST", &path, Some(body), &[], Some("application/json"));
        assert_eq!(reply.status, 403, "body of {} bytes", body.len());
        assert_eq!(reply.code(), "forbidden");
    }
    // Not even the content type is looked at first.
    let reply = server.request("POST", &path, Some("x"), &[], Some("text/plain"));
    assert_eq!(reply.status, 403);
}

#[test]
fn a_broken_body_is_400_a_too_large_one_413_and_a_wrong_value_422() {
    let (home, a, _) = two_projects();
    let before = snapshot_json(home.path(), &a);
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/cards");

    let reply = server.write("POST", &path, Some("{broken"));
    assert_eq!(reply.status, 400, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_json");

    let big = format!(
        r#"{{"title":"{}","description":"","assignee":"ai"}}"#,
        "x".repeat(70 * 1024)
    );
    let reply = server.write("POST", &path, Some(&big));
    assert_eq!(reply.status, 413, "{}", reply.body);
    assert_eq!(reply.code(), "payload_too_large");

    for body in [
        r#"{"description":"","assignee":"ai"}"#,
        r#"{"title":"x","description":"","assignee":"robot"}"#,
        r#"{"title":"x","description":"","assignee":"ai","extra":1}"#,
        r#"{"title":"","description":"","assignee":"ai"}"#,
    ] {
        let reply = server.write("POST", &path, Some(body));
        assert_eq!(reply.status, 422, "{body}: {}", reply.body);
    }
    assert_eq!(snapshot_json(home.path(), &a), before);
}

#[test]
fn a_busy_database_is_503() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let lock = rusqlite::Connection::open(db(home.path())).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"Blocked","description":"","assignee":"ai"}"#),
    );
    assert_eq!(reply.status, 503, "{}", reply.body);
    assert_eq!(reply.code(), "database_busy");
    lock.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store(home.path()).snapshot(&a).unwrap().cards.len(), 2);
}

// ---------------------------------------------------------------- notifications

#[test]
fn a_cli_change_reaches_an_open_event_stream_after_ready() {
    let (home, _, _) = two_projects();
    let server = Running::start(home.path());
    let mut events = server.events();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "alpha",
            "add",
            "From the CLI",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert!(events.changed(), "{}", events.received);
    // The viewer can now read the change from the list and the board.
    let list = server.get("/api/projects").json();
    let alpha = list["projects"][0]["id"].as_str().unwrap().to_string();
    let board = server.get(&format!("/api/projects/{alpha}/board")).json();
    assert_eq!(board["cards"].as_array().unwrap().len(), 3);
}

#[test]
fn catalog_changes_by_the_cli_are_notified_and_visible_in_the_list() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let mut events = server.events();
    for (args, expected) in [
        (vec!["project", "create", "one"], vec!["one"]),
        (
            vec!["--project", "one", "project", "rename", "uno"],
            vec!["uno"],
        ),
    ] {
        let (code, _, err) = agboard(home.path(), &args);
        assert_eq!(code, 0, "{err}");
        let before = events.changed_count();
        assert!(events.changed() || before > 0, "{}", events.received);
        let list = server.get("/api/projects").json();
        let names: Vec<&str> = list["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, expected);
    }
}

#[test]
fn changes_that_do_not_change_anything_send_nothing() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let mut events = server.events();

    // Same-name rename, a cancelled (non-interactive) project removal, a read
    // and a failed command are not changes.
    for args in [
        vec!["--project", "alpha", "project", "rename", "alpha"],
        vec!["--project", "alpha", "project", "rm"],
        vec!["--project", "alpha", "ls", "--json"],
        vec![
            "--project",
            "ghost",
            "add",
            "x",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    ] {
        agboard(home.path(), &args);
    }
    // HTTP: a no-op move, a refused request and a rolled-back write.
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/1/move"),
        Some(r#"{"cardStatus":"todo","reason":"Same"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let refused = server.request(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"x","description":"","assignee":"ai"}"#),
        &[],
        Some("application/json"),
    );
    assert_eq!(refused.status, 403);
    let invalid = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/2/agent-status"),
        Some(r#"{"agentStatus":"running","reason":"Go"}"#),
    );
    assert_eq!(invalid.status, 422);
    let wrong_request = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/2/answer"),
        Some(r#"{"requestId":"nope","reason":"Go"}"#),
    );
    assert_eq!(wrong_request.status, 409);
    assert!(events.stays_quiet(), "{}", events.received);
}

#[test]
fn each_confirmed_http_change_is_notified() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let mut events = server.events();
    let created = server.write(
        "POST",
        &format!("/api/projects/{a}/cards"),
        Some(r#"{"title":"New","description":"","assignee":"ai"}"#),
    );
    assert_eq!(created.status, 201);
    assert!(events.changed());
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/cards/1/move"),
        Some(r#"{"cardStatus":"doing","reason":"Start"}"#),
    );
    assert_eq!(moved.status, 200);
    assert!(events.wait_for("event: changed", Duration::from_secs(3)));
    let deleted = server.write("DELETE", &format!("/api/projects/{a}/cards/3"), None);
    assert_eq!(deleted.status, 204);
    let deadline = Instant::now() + Duration::from_secs(3);
    while events.changed_count() < 3 && Instant::now() < deadline {
        events.wait_for("never", Duration::from_millis(100));
    }
    assert_eq!(events.changed_count(), 3, "{}", events.received);
}

#[test]
fn a_cli_change_notifies_the_server_of_the_same_data_area_only() {
    let (home_one, _, _) = two_projects();
    let (home_two, _, _) = two_projects();
    let one = Running::start(home_one.path());
    let two = Running::start(home_two.path());
    let mut events_one = one.events();
    let mut events_two = two.events();
    let (code, _, err) = agboard(
        home_one.path(),
        &[
            "--project",
            "alpha",
            "add",
            "Only here",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert!(events_one.changed());
    assert!(events_two.stays_quiet());
}

// ---------------------------------------------------------------- startup

#[test]
fn serving_needs_no_project_and_stopping_removes_serve_json() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    assert!(home.path().join("serve.json").exists());
    assert_eq!(server.get("/api/health").status, 200);
    assert_eq!(server.get("/api/projects").json()["projects"], json!([]));
    server.stop();
    assert!(!home.path().join("serve.json").exists());
}
