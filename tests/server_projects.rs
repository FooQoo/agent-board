//! The multi-project HTTP surface of `agboard serve`: the project list, the
//! per-project board and task routes, guard ordering, and the change
//! notifications that reach connected browsers.
//!
//! Servers listen on port 0 in a temporary data directory. The CLI is run as
//! the real `agboard` binary against the same `AGBOARD_HOME`.

#[path = "support/detail_lines.rs"]
mod detail_lines;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use agent_board::server::{ServeConfig, run_until};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Value, json};

// ---------------------------------------------------------------- harness

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

fn store(home: &Path) -> FileStore {
    FileStore::open(&home.join("shared"))
}

/// A TASK.md body that the file store accepts.
const BODY: &str = "## 作業内容\n\nDetails\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Done\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";

/// A TASK.md body with `text` in its work section, which the file store accepts.
fn body_with(text: &str) -> String {
    format!(
        "## 作業内容\n\n{text}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
}

/// A TASK.md body of exactly `count` characters that the file store accepts.
fn body_of(count: usize) -> String {
    const HEAD: &str = "## 作業内容\n\n";
    const TAIL: &str = "\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";
    let fixed = HEAD.chars().count() + TAIL.chars().count();
    format!("{HEAD}{}{TAIL}", "あ".repeat(count - fixed))
}

fn replace_task_body_preserving_history(path: &Path, description: &str) {
    let current = std::fs::read_to_string(path).unwrap();
    let stored = agent_board::file_store::history::parse_task(
        &current,
        agent_board::file_store::history::ParseMode::Stored,
    );
    let input = agent_board::file_store::history::parse_task(
        description,
        agent_board::file_store::history::ParseMode::NewInput,
    );
    let next = agent_board::file_store::history::compose_task(
        description,
        &input.body,
        Some(&input.acceptance),
        &stored.history,
    )
    .unwrap();
    std::fs::write(path, next).unwrap();
}

/// Read `path` until `done` holds or three seconds pass. A save made outside
/// the server reaches the reads after the watcher's short quiet period (AC-3).
fn read_until(server: &Running, path: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let value = server.get(path).json();
        if done(&value) || std::time::Instant::now() > deadline {
            return value;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn task(title: &str, assignee: Assignee) -> NewTask {
    NewTask {
        title: title.into(),
        description: BODY.into(),
        assignee,
        actor: Actor::Human,
        is_draft: false,
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
    headers: Vec<(String, String)>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| panic!("not JSON: {:?}", self.body))
    }
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    fn code(&self) -> String {
        self.json()["error"]["code"].as_str().unwrap().to_string()
    }
}

struct Running {
    addr: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    handle: Option<JoinHandle<Result<(), AgboardError>>>,
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
        let marker = "name=\"agboard-token\" content=\"";
        let start = page.find(marker).expect("token meta tag") + marker.len();
        page[start..start + 64].to_string()
    }

    fn page_headers(&self, token: &str) -> Vec<(String, String)> {
        vec![
            ("Origin".into(), format!("http://127.0.0.1:{}", self.port())),
            ("Sec-Fetch-Site".into(), "same-origin".into()),
            ("X-Agboard-Token".into(), token.into()),
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
        let request = builder.body(body.unwrap_or("").to_string()).unwrap();
        // The server answers a refused write before it reads the body and closes the connection, so on macOS
        // the client can see the reset while it is still sending (an I/O error such as EINVAL) instead of the
        // answer. That is a race in the client, not a different answer; ask again.
        let mut attempts = 0;
        let mut response = loop {
            match agent.run(request.clone()) {
                Ok(response) => break response,
                Err(ureq::Error::Io(error))
                    if attempts < 4
                        && matches!(
                            error.kind(),
                            std::io::ErrorKind::InvalidInput
                                | std::io::ErrorKind::BrokenPipe
                                | std::io::ErrorKind::ConnectionReset
                        ) =>
                {
                    attempts += 1;
                }
                Err(error) => panic!("{method} {path}: {error:?}"),
            }
        };
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
            .collect();
        Reply {
            status: response.status().as_u16(),
            headers,
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
        .env("AGBOARD_HOME", home)
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

/// Two projects "alpha" and "beta", each with tasks 1 and 2 (task 1 human,
/// task 2 AI), so the same task number exists in both.
fn two_projects() -> (tempfile::TempDir, ProjectId, ProjectId) {
    let home = tempfile::tempdir().unwrap();
    let s = store(home.path());
    let a = s.create_project("alpha", t(0)).unwrap().id;
    let b = s.create_project("beta", t(0)).unwrap().id;
    for id in [&a, &b] {
        s.create_task(id, task("Human task", Assignee::Human), t(1))
            .unwrap();
        s.create_task(id, task("AI task", Assignee::Ai), t(2))
            .unwrap();
    }
    (home, a, b)
}

fn snapshot_json(home: &Path, id: &ProjectId) -> Value {
    let snapshot = store(home).board(id).unwrap();
    json!({
        "version": snapshot.version,
        "tasks": serde_json::to_value(&snapshot.tasks).unwrap(),
    })
}

#[test]
fn serve_reconciles_existing_completed_tasks_and_rechecks_external_task_edits() {
    let home = tempfile::tempdir().unwrap();
    let store = store(home.path());
    let project = store.create_project("auto-done", t(0)).unwrap().id;
    let create = |title: &str| {
        store.create_task(
            &project,
            NewTask {
                title: title.into(),
                description: "---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: false\n---\n\nWork.\n".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            t(1),
        ).unwrap()
    };
    let existing = create("Already complete");
    let edited = create("Edited while serving");
    let pending_task = create("Answered while serving");
    store
        .move_work_task(&project, pending_task.id, Column::Doing, ctx("Start"), t(2))
        .unwrap();
    let request = store
        .request_decision(
            &project,
            pending_task.id,
            Actor::Ai,
            "Choose",
            vec![
                Choice {
                    id: "a".into(),
                    label: "A".into(),
                },
                Choice {
                    id: "b".into(),
                    label: "B".into(),
                },
            ],
            t(3),
        )
        .unwrap()
        .value
        .pending_request_id
        .unwrap();
    let task_path = |id: i64| {
        home.path()
            .join("shared")
            .join("projects")
            .join(project.as_str())
            .join("tasks")
            .join(id.to_string())
            .join("TASK.md")
    };
    let complete =
        "---\nacceptance:\n  - id: AC-1\n    text: Works\n    done: true\n---\n\nWork.\n";
    replace_task_body_preserving_history(&task_path(existing.id), complete);

    let server = Running::start(home.path());
    let board_path = format!("/api/projects/{project}/summary");
    let board = server.get(&board_path).json();
    assert_eq!(board["tasks"][0]["taskStatus"], "done");
    let detail = server.get(&format!(
        "/api/projects/{project}/tasks/{}/detail?sections=history",
        existing.id
    ));
    assert_eq!(detail.status, 200, "{}", detail.body);
    assert_eq!(detail_lines::history(&detail.body).len(), 2);

    replace_task_body_preserving_history(&task_path(edited.id), complete);
    let notified = server.request("POST", "/api/notify", None, &[], None);
    assert_eq!(notified.status, 204, "{}", notified.body);
    let board = read_until(&server, &board_path, |board| {
        board["tasks"].as_array().is_some_and(|tasks| {
            tasks
                .iter()
                .any(|task| task["id"] == edited.id && task["taskStatus"] == "done")
        })
    });
    let edited_json = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["id"] == edited.id)
        .unwrap();
    assert_eq!(edited_json["taskStatus"], "done");
    let detail = server.get(&format!(
        "/api/projects/{project}/tasks/{}/detail?sections=history",
        edited.id
    ));
    assert_eq!(detail.status, 200, "{}", detail.body);
    assert_eq!(detail_lines::history(&detail.body).len(), 2);

    replace_task_body_preserving_history(&task_path(pending_task.id), complete);
    let answer = server.write(
        "POST",
        &format!("/api/projects/{project}/tasks/{}/answer", pending_task.id),
        Some(
            &json!({
                "requestId": request,
                "choiceId": "a"
            })
            .to_string(),
        ),
    );
    assert_eq!(answer.status, 200, "{}", answer.body);
    let board = read_until(&server, &board_path, |board| {
        board["tasks"].as_array().is_some_and(|tasks| {
            tasks
                .iter()
                .any(|task| task["id"] == pending_task.id && task["taskStatus"] == "done")
        })
    });
    assert_eq!(
        board["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|task| task["id"] == pending_task.id)
            .unwrap()["taskStatus"],
        "done"
    );
}

// ---------------------------------------------------------------- project list

#[test]
fn the_list_of_a_new_data_area_is_empty_with_the_empty_catalog_version() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let reply = server.get("/api/projects");
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        reply.json(),
        json!({"projects": [], "catalogVersion": "e3b0c44298fc1c149afbf4c8996fb924"})
    );
}

#[test]
fn the_list_has_every_project_by_name_with_no_tasks_and_the_catalog_version() {
    let (home, a, b) = two_projects();
    // Created out of name order on purpose.
    let zed = store(home.path()).create_project("Zed", t(3)).unwrap();
    let server = Running::start(home.path());
    let reply = server.get("/api/projects");
    assert_eq!(reply.status, 200, "{}", reply.body);
    let catalog = store(home.path()).catalog().unwrap();
    let body = reply.json();
    assert_eq!(body["catalogVersion"], catalog.catalog_version);
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
        assert_eq!(
            keys.len(),
            4,
            "only id, name, createdAt and docsPath: {project}"
        );
    }
    assert!(!reply.body.contains("tasks"));
}

#[test]
fn the_catalog_version_follows_catalog_changes_and_the_list_is_re_read() {
    let home = tempfile::tempdir().unwrap();
    let server = Running::start(home.path());
    let before = server.get("/api/projects").json()["catalogVersion"]
        .as_str()
        .unwrap()
        .to_string();
    let (code, _, err) = agboard(home.path(), &["project", "create", "fresh"]);
    assert_eq!(code, 0, "{err}");
    let after = server.get("/api/projects").json();
    assert_eq!(after["projects"].as_array().unwrap().len(), 1);
    assert_eq!(after["projects"][0]["name"], "fresh");
    assert_ne!(after["catalogVersion"].as_str().unwrap(), before);
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
fn the_summary_lists_the_tasks_and_the_detail_has_the_full_history_and_no_next_task_id() {
    let (home, a, _) = two_projects();
    store(home.path())
        .move_work_task(&a, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let server = Running::start(home.path());
    let reply = server.get(&format!("/api/projects/{a}/summary"));
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    assert!(!reply.body.contains("nextTaskId"));
    assert_eq!(body["project"]["id"], a.to_string());
    assert_eq!(body["version"].as_str().unwrap().len(), 32);
    assert_eq!(body["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(body["tasks"][1]["id"], 2);
    let detail = server.get(&format!(
        "/api/projects/{a}/tasks/2/detail?sections=history"
    ));
    assert_eq!(detail.status, 200, "{}", detail.body);
    assert!(!detail.body.contains("nextTaskId"));
    assert_eq!(detail_lines::history(&detail.body).len(), 2);
}

#[test]
fn the_same_task_number_is_read_separately_per_project() {
    let (home, a, b) = two_projects();
    store(home.path())
        .move_work_task(&a, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let server = Running::start(home.path());
    let alpha = server.get(&format!("/api/projects/{a}/summary")).json();
    let beta = server.get(&format!("/api/projects/{b}/summary")).json();
    assert_eq!(alpha["tasks"][1]["taskStatus"], "doing");
    assert_eq!(beta["tasks"][1]["taskStatus"], "todo");
    assert_ne!(alpha["project"]["id"], beta["project"]["id"]);
}

#[test]
fn a_missing_or_malformed_project_and_the_old_routes_are_not_found_or_invalid() {
    let (home, _, _) = two_projects();
    let server = Running::start(home.path());
    let ghost = ProjectId::generate().unwrap();
    let reply = server.get(&format!("/api/projects/{ghost}/summary"));
    assert_eq!(reply.status, 404);
    assert_eq!(reply.code(), "project_not_found");
    for bad in ["not-an-id", "ABCDEF0123456789ABCDEF0123456789", "alpha"] {
        let reply = server.get(&format!("/api/projects/{bad}/summary"));
        assert_eq!(reply.status, 422, "{bad}: {}", reply.body);
        assert_eq!(reply.code(), "invalid_value");
    }
    assert_eq!(server.get("/api/board").status, 404);
    assert_eq!(
        server
            .write(
                "POST",
                "/api/tasks",
                Some(r#"{"title":"x","description":"","assignee":"ai"}"#)
            )
            .status,
        404
    );
}

// ---------------------------------------------------------------- writes

#[test]
fn creating_a_task_in_one_project_leaves_the_other_untouched_and_is_a_human_action() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks"),
        Some(r#"{"title":"New","description":"","assignee":"ai"}"#),
    );
    assert_eq!(reply.status, 201, "{}", reply.body);
    let created = reply.json();
    assert_eq!(created["task"]["id"], 3);
    assert_eq!(created["task"]["taskStatus"], "todo");
    assert_eq!(created["task"]["agentStatus"], "idle");
    assert_eq!(created["task"]["history"][0].as_object().unwrap().len(), 2);
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn an_actor_sent_by_the_page_is_never_trusted() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let created = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks"),
        Some(r#"{"title":"Sneaky","body":"Work","acceptance":[{"id":"AC-1","text":"Still incomplete","done":false}],"assignee":"ai","actor":"ai"}"#),
    );
    assert_eq!(created.status, 201, "{}", created.body);
    assert_eq!(
        created.json()["task"]["history"][0]
            .as_object()
            .unwrap()
            .len(),
        2
    );
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/3/move"),
        Some(r#"{"taskStatus":"doing","actor":"ai","reason":"Start"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let history = moved.json()["task"]["history"].clone();
    let last = history.as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["reason"], "Start");
    assert_eq!(last.as_object().unwrap().len(), 2);
    // A page action remains human-authorized even with a supplied AI actor,
    // so unmet acceptance does not trigger the agent-only Done guard.
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/3/move"),
        Some(r#"{"taskStatus":"done","actor":"ai","reason":"Finish"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
}

#[test]
fn moving_task_one_in_alpha_does_not_move_task_one_in_beta() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/1/move"),
        Some(r#"{"taskStatus":"doing","reason":"Start"}"#),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["taskStatus"], "doing");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

fn pending_request(home: &Path, id: &ProjectId) -> String {
    let s = store(home);
    s.move_work_task(id, 2, Column::Doing, ctx("Start"), t(4))
        .unwrap();
    let result = s
        .request_decision(
            id,
            2,
            agent_board::domain::Actor::Ai,
            "Need direction",
            two_choices(),
            t(5),
        )
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

    // beta's request does not answer alpha's task.
    let body = json!({"requestId": request_b, "text": "Go"}).to_string();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/2/answer"),
        Some(&body),
    );
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "request_changed");
    assert_eq!(snapshot_json(home.path(), &a), before_a);
    assert_eq!(snapshot_json(home.path(), &b), before_b);

    let body = json!({"requestId": request_a, "text": "Go"}).to_string();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/2/answer"),
        Some(&body),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["agentStatus"], "idle");
    assert_eq!(snapshot_json(home.path(), &b), before_b);
}

#[test]
fn agent_status_through_http_keeps_the_state_rules() {
    let (home, a, b) = two_projects();
    let before_b = snapshot_json(home.path(), &b);
    let server = Running::start(home.path());
    // The AI task is still in TODO: an agent state is only allowed in DOING.
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/2/agent-status"),
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
    let archived = server.write("POST", &format!("/api/projects/{a}/tasks/1/archive"), None);
    assert_eq!(archived.status, 200, "{}", archived.body);
    let reply = server.write("DELETE", &format!("/api/projects/{a}/tasks/1"), None);
    assert_eq!(reply.status, 204, "{}", reply.body);
    let ids: Vec<i64> = store(home.path())
        .board(&a)
        .unwrap()
        .tasks
        .iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(ids, vec![2]);
    assert_eq!(snapshot_json(home.path(), &b), before_b);
    let again = server.write("DELETE", &format!("/api/projects/{a}/tasks/1"), None);
    assert_eq!(again.status, 404);
    assert_eq!(again.code(), "task_not_found");
}

#[test]
fn a_write_to_a_project_that_was_deleted_is_404_and_never_lands_in_another() {
    let (home, a, b) = two_projects();
    let server = Running::start(home.path());
    let _ = server.get(&format!("/api/projects/{a}/summary"));
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
            format!("/api/projects/{a}/tasks"),
            Some(r#"{"title":"Late","description":"","assignee":"ai"}"#),
        ),
        (
            "POST",
            format!("/api/projects/{a}/tasks/1/move"),
            Some(r#"{"taskStatus":"doing","reason":"Late"}"#),
        ),
        ("DELETE", format!("/api/projects/{a}/tasks/1"), None),
    ] {
        let reply = server.write(method, &path, body);
        assert_eq!(reply.status, 404, "{method} {path}: {}", reply.body);
        assert_eq!(reply.code(), "project_not_found");
    }
    assert_eq!(
        server.get(&format!("/api/projects/{a}/summary")).status,
        404
    );
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
    let board = read_until(&server, &format!("/api/projects/{a}/summary"), |b| {
        b["project"]["name"] == "renamed"
    });
    assert_eq!(board["project"]["name"], "renamed");
    assert_eq!(board["project"]["id"], a.to_string());
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks"),
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
            "/tasks",
            Some(r#"{"title":"x","description":"","assignee":"ai"}"#),
        ),
        (
            "POST",
            "/tasks/1/move",
            Some(r#"{"taskStatus":"doing","reason":"r"}"#),
        ),
        (
            "POST",
            "/tasks/2/agent-status",
            Some(r#"{"agentStatus":"pending","reason":"r"}"#),
        ),
        (
            "POST",
            "/tasks/2/answer",
            Some(r#"{"requestId":"x","text":"r"}"#),
        ),
        ("DELETE", "/tasks/1", None),
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
            ("X-Agboard-Token".to_string(), token.clone()),
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
        ("no token", good("X-Agboard-Token")),
        ("bad token", wrong("X-Agboard-Token", &"0".repeat(64))),
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
    let path = format!("/api/projects/{a}/tasks");
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
    let path = format!("/api/projects/{a}/tasks");

    let reply = server.write("POST", &path, Some("{broken"));
    assert_eq!(reply.status, 400, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_json");

    let big = format!(
        r#"{{"title":"{}","description":"","assignee":"ai"}}"#,
        "x".repeat(1024 * 1024 + 1)
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
    // Another writer holds the project's write lock: the write waits its 5 s
    // and is then refused with database_busy, changing nothing.
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let project_dir = home.path().join("shared/projects").join(a.as_str());
    let _held = agent_board::file_store::lock::WriteLock::acquire(
        &agent_board::file_store::layout::write_lock(&project_dir),
    )
    .unwrap();
    let reply = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks"),
        Some(r#"{"title":"Blocked","description":"","assignee":"ai"}"#),
    );
    assert_eq!(reply.status, 503, "{}", reply.body);
    assert_eq!(reply.code(), "database_busy");
    drop(_held);
    assert_eq!(store(home.path()).board(&a).unwrap().tasks.len(), 2);
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
    let board = server.get(&format!("/api/projects/{alpha}/summary")).json();
    assert_eq!(board["tasks"].as_array().unwrap().len(), 3);
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
        &format!("/api/projects/{a}/tasks/1/move"),
        Some(r#"{"taskStatus":"todo","reason":"Same"}"#),
    );
    assert_eq!(moved.status, 200, "{}", moved.body);
    let refused = server.request(
        "POST",
        &format!("/api/projects/{a}/tasks"),
        Some(r#"{"title":"x","description":"","assignee":"ai"}"#),
        &[],
        Some("application/json"),
    );
    assert_eq!(refused.status, 403);
    let invalid = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/2/agent-status"),
        Some(r#"{"agentStatus":"running","reason":"Go"}"#),
    );
    assert_eq!(invalid.status, 422);
    let wrong_request = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/2/answer"),
        Some(r#"{"requestId":"nope","text":"Go"}"#),
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
        &format!("/api/projects/{a}/tasks"),
        Some(r#"{"title":"New","description":"","assignee":"ai"}"#),
    );
    assert_eq!(created.status, 201);
    assert!(events.changed());
    let moved = server.write(
        "POST",
        &format!("/api/projects/{a}/tasks/1/move"),
        Some(r#"{"taskStatus":"doing","reason":"Start"}"#),
    );
    assert_eq!(moved.status, 200);
    assert!(events.wait_for("event: changed", Duration::from_secs(3)));
    let archived = server.write("POST", &format!("/api/projects/{a}/tasks/3/archive"), None);
    assert_eq!(archived.status, 200, "{}", archived.body);
    assert!(events.wait_for("event: changed", Duration::from_secs(3)));
    let deleted = server.write("DELETE", &format!("/api/projects/{a}/tasks/3"), None);
    assert_eq!(deleted.status, 204);
    let deadline = Instant::now() + Duration::from_secs(3);
    while events.changed_count() < 4 && Instant::now() < deadline {
        events.wait_for("never", Duration::from_millis(100));
    }
    assert_eq!(events.changed_count(), 4, "{}", events.received);
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

// ---------------------------------------------------------------- drafts and editing

fn draft_task(home: &Path, project: &ProjectId, id: i64) {
    store(home).set_draft(project, id, true, t(9)).unwrap();
}

fn task_json(home: &Path, project: &ProjectId, id: i64) -> Value {
    snapshot_json(home, project)["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn patch_edits_a_draft_and_reports_changes_only_when_something_changed() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 1);
    let server = Running::start(home.path());
    let mut events = server.events();
    let path = format!("/api/projects/{a}/tasks/1");
    let before_revision = snapshot_json(home.path(), &a)["version"]
        .as_str()
        .unwrap()
        .to_string();

    let reply = server.write("PATCH", &path, Some(r#"{"title":"New title"}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["title"], "New title");
    assert_eq!(reply.json()["task"]["isDraft"], true);
    assert!(events.changed());
    let after = snapshot_json(home.path(), &a);
    assert_ne!(after["version"].as_str().unwrap(), before_revision);

    let head = "## 作業内容\n\n";
    let tail = "\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";
    let raw = format!("{head}Line1\r\nLine2{tail}");
    let reply = server.write(
        "PATCH",
        &path,
        Some(&json!({"description": raw}).to_string()),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        reply.json()["task"]["body"],
        format!("{head}Line1\nLine2{tail}")
    );
    assert!(
        reply.json()["task"]["description"]
            .as_str()
            .unwrap()
            .contains("history:")
    );

    // Nothing differs: 200, no change, no notification.
    events.wait_for("never-sent", Duration::from_millis(600));
    let count = events.changed_count();
    assert_eq!(count, 2);
    let revision = snapshot_json(home.path(), &a)["version"].clone();
    let reply = server.write("PATCH", &path, Some(r#"{"title":"New title"}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(snapshot_json(home.path(), &a)["version"], revision);
    events.wait_for("never-sent", Duration::from_millis(600));
    assert_eq!(events.changed_count(), count);
}

#[test]
fn patch_with_finalize_saves_and_confirms_in_one_operation() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 1);
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/tasks/1");
    let reply = server.write(
        "PATCH",
        &path,
        Some(
            &json!({"title":"Final","description": body_with("Body"), "finalize": true})
                .to_string(),
        ),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["isDraft"], false);
    let stored = task_json(home.path(), &a, 1);
    assert_eq!(stored["isDraft"], false);
    assert_eq!(stored["title"], "Final");
    assert_eq!(stored["body"], body_with("Body"));
    assert!(stored["description"].as_str().unwrap().contains("history:"));
    // A confirmed task is no longer editable.
    let reply = server.write("PATCH", &path, Some(r#"{"title":"Again"}"#));
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "task_not_draft");
    assert_eq!(task_json(home.path(), &a, 1)["title"], "Final");
}

#[test]
fn patch_of_a_task_that_is_not_a_draft_is_409_and_changes_nothing() {
    let (home, a, _) = two_projects();
    let before = snapshot_json(home.path(), &a);
    let server = Running::start(home.path());
    let mut events = server.events();
    let reply = server.write(
        "PATCH",
        &format!("/api/projects/{a}/tasks/1"),
        Some(r#"{"title":"X"}"#),
    );
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "task_not_draft");
    assert_eq!(snapshot_json(home.path(), &a), before);
    assert!(events.stays_quiet());
}

#[test]
fn patch_description_limit_is_50000_characters_and_the_body_limit_1_mib() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 1);
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/tasks/1");

    // 50,000 Japanese characters are about 150 KB.
    let ok = json!({"description": body_of(50_000)}).to_string();
    assert!(ok.len() > 64 * 1024);
    let reply = server.write("PATCH", &path, Some(&ok));
    assert_eq!(
        reply.status,
        200,
        "{}",
        &reply.body[..reply.body.len().min(200)]
    );

    let over = json!({"description": "あ".repeat(50_001)}).to_string();
    let reply = server.write("PATCH", &path, Some(&over));
    assert_eq!(reply.status, 422);
    assert_eq!(reply.code(), "invalid_value");
    assert_eq!(
        task_json(home.path(), &a, 1)["body"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        50_000
    );

    let huge = json!({"description": "x".repeat(1024 * 1024 + 1)}).to_string();
    let reply = server.write("PATCH", &path, Some(&huge));
    assert_eq!(reply.status, 413);
    assert_eq!(reply.code(), "payload_too_large");

    // Registration takes the same size.
    let create = json!({"title":"Long","description":body_of(50_000),"assignee":"ai"}).to_string();
    let reply = server.write("POST", &format!("/api/projects/{a}/tasks"), Some(&create));
    assert_eq!(
        reply.status,
        201,
        "{}",
        &reply.body[..reply.body.len().min(200)]
    );
}

#[test]
fn patch_rejects_bad_bodies_without_changing_anything() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 1);
    let before = snapshot_json(home.path(), &a);
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/tasks/1");

    let reply = server.write("PATCH", &path, Some("{broken"));
    assert_eq!(reply.status, 400);
    let reply = server.write("PATCH", &path, Some(r#"{"title":"x","extra":1}"#));
    assert_eq!(reply.status, 400, "{}", reply.body);

    let reply = server.write("PATCH", &path, Some("{}"));
    assert_eq!(reply.status, 422, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_argument");
    assert!(
        reply.json()["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Nothing to change")
    );

    let reply = server.write("PATCH", &path, Some(r#"{"title":""}"#));
    assert_eq!(reply.status, 422);
    assert_eq!(reply.code(), "invalid_value");

    let reply = server.write(
        "PATCH",
        &format!("/api/projects/{a}/tasks/99"),
        Some(r#"{"title":"x"}"#),
    );
    assert_eq!(reply.status, 404);
    assert_eq!(reply.code(), "task_not_found");
    assert_eq!(snapshot_json(home.path(), &a), before);
}

#[test]
fn put_draft_toggles_idle_tasks_and_records_history_with_markdown_time() {
    let (home, a, _) = two_projects();
    let server = Running::start(home.path());
    let mut events = server.events();
    let path = format!("/api/projects/{a}/tasks/1/draft");
    let before = task_json(home.path(), &a, 1);
    let revision = snapshot_json(home.path(), &a)["version"]
        .as_str()
        .unwrap()
        .to_string();

    let reply = server.write("PUT", &path, Some(r#"{"isDraft":true}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["isDraft"], true);
    assert!(events.changed());
    let after = task_json(home.path(), &a, 1);
    let task_dir = home
        .path()
        .join("shared/projects")
        .join(a.as_str())
        .join("tasks/1");
    let markdown_modified = DateTime::<Utc>::from(
        std::fs::metadata(task_dir.join("TASK.md"))
            .unwrap()
            .modified()
            .unwrap(),
    );
    let markdown_modified = DateTime::from_timestamp(markdown_modified.timestamp(), 0).unwrap();
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(task_dir.join("task.json")).unwrap()).unwrap();
    let metadata_updated_at = DateTime::parse_from_rfc3339(metadata["updatedAt"].as_str().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    let reported_updated_at = DateTime::parse_from_rfc3339(after["updatedAt"].as_str().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(
        reported_updated_at,
        metadata_updated_at.max(markdown_modified),
        "updatedAt is the newer of task.json and TASK.md timestamps"
    );
    assert!(
        reported_updated_at
            >= DateTime::parse_from_rfc3339(before["updatedAt"].as_str().unwrap())
                .unwrap()
                .with_timezone(&Utc)
    );
    // A real draft change rewrites TASK.md and appends a history event.
    let added = after["history"].as_array().unwrap();
    assert_eq!(added.len(), before["history"].as_array().unwrap().len() + 1);
    assert_eq!(
        added.last().unwrap()["reason"],
        "タスクを下書きにしました。"
    );
    // The flag is part of task.json, so the content version moves.
    assert_ne!(
        snapshot_json(home.path(), &a)["version"]
            .as_str()
            .unwrap()
            .to_string(),
        revision
    );

    // Same value: 200, no change, no notification.
    let count = events.changed_count();
    let reply = server.write("PUT", &path, Some(r#"{"isDraft":true}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    events.wait_for("never-sent", Duration::from_millis(600));
    assert_eq!(events.changed_count(), count);

    let reply = server.write("PUT", &path, Some(r#"{"isDraft":false}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["isDraft"], false);

    let reply = server.write("PUT", &path, Some(r#"{"isDraft":true,"x":1}"#));
    assert_eq!(reply.status, 400, "{}", reply.body);
    let reply = server.write("PUT", &path, Some("{}"));
    assert_eq!(reply.status, 422, "{}", reply.body);
    let reply = server.write(
        "PUT",
        &format!("/api/projects/{a}/tasks/99/draft"),
        Some(r#"{"isDraft":true}"#),
    );
    assert_eq!(reply.status, 404);
}

#[test]
fn put_draft_refuses_running_but_allows_pending_tasks() {
    let (home, a, _) = two_projects();
    let s = store(home.path());
    s.move_work_task(&a, 2, Column::Doing, ctx("Start"), t(3))
        .unwrap();
    s.set_agent_status(&a, 2, RunState::Running, ctx("Go"), None, t(4))
        .unwrap();
    let before = snapshot_json(home.path(), &a);
    let server = Running::start(home.path());
    let path = format!("/api/projects/{a}/tasks/2/draft");
    let reply = server.write("PUT", &path, Some(r#"{"isDraft":true}"#));
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "invalid_state_for_draft");

    s.request_decision(
        &a,
        2,
        agent_board::domain::Actor::Ai,
        "Ask",
        two_choices(),
        t(5),
    )
    .unwrap();
    let before_pending = snapshot_json(home.path(), &a);
    let reply = server.write("PUT", &path, Some(r#"{"isDraft":true}"#));
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["isDraft"], true);
    assert_ne!(
        snapshot_json(home.path(), &a)["version"],
        before_pending["version"]
    );
    assert_ne!(before, before_pending);
}

#[test]
fn a_draft_task_can_be_moved_and_deleted_by_the_user_but_not_driven_by_the_ai_route() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 2);
    draft_task(home.path(), &a, 1);
    let server = Running::start(home.path());
    let base = format!("/api/projects/{a}/tasks");

    let reply = server.write(
        "POST",
        &format!("{base}/2/move"),
        Some(r#"{"taskStatus":"doing","actor":"human","reason":"Start"}"#),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["task"]["taskStatus"], "doing");
    assert_eq!(reply.json()["task"]["agentStatus"], "idle");
    assert_eq!(reply.json()["task"]["isDraft"], true);

    let before = snapshot_json(home.path(), &a);
    let reply = server.write(
        "POST",
        &format!("{base}/2/agent-status"),
        Some(r#"{"agentStatus":"running","actor":"ai","reason":"Go"}"#),
    );
    assert_eq!(reply.status, 409, "{}", reply.body);
    assert_eq!(reply.code(), "task_is_draft");
    assert_eq!(snapshot_json(home.path(), &a), before);

    let headers = server.page_headers(&server.token());
    let archived = server.request("POST", &format!("{base}/1/archive"), None, &headers, None);
    assert_eq!(archived.status, 200, "{}", archived.body);
    let reply = server.request("DELETE", &format!("{base}/1"), None, &headers, None);
    assert_eq!(reply.status, 204);
}

#[test]
fn patch_and_put_draft_need_the_write_guard_before_anything_else() {
    let (home, a, _) = two_projects();
    draft_task(home.path(), &a, 1);
    let before = snapshot_json(home.path(), &a);
    let server = Running::start(home.path());
    let mut events = server.events();
    let token = server.token();
    let wrong = "0".repeat(64);
    let good = server.page_headers(&token);
    let mut bad_origin = good.clone();
    bad_origin[0].1 = "http://evil.example".into();
    let mut bad_site = good.clone();
    bad_site[1].1 = "cross-site".into();
    let mut bad_token = good.clone();
    bad_token[2].1 = wrong;
    let attempts: [Vec<(String, String)>; 4] = [Vec::new(), bad_origin, bad_site, bad_token];
    for (method, suffix, body) in [
        ("PATCH", "tasks/1", r#"{"title":"Hacked"}"#),
        ("PATCH", "tasks/99", r#"{"title":"Hacked"}"#),
        ("PUT", "tasks/1/draft", r#"{"isDraft":false}"#),
        ("PUT", "tasks/99/draft", r#"{"isDraft":false}"#),
    ] {
        for headers in &attempts {
            let reply = server.request(
                method,
                &format!("/api/projects/{a}/{suffix}"),
                Some(body),
                headers,
                Some("application/json"),
            );
            assert_eq!(reply.status, 403, "{method} {suffix}: {}", reply.body);
        }
    }
    assert_eq!(snapshot_json(home.path(), &a), before);
    assert!(events.stays_quiet());
}

#[test]
fn the_page_carries_a_content_security_policy_and_no_referrer() {
    let (home, _, _) = two_projects();
    let server = Running::start(home.path());
    let page = server.get("/");
    assert_eq!(page.status, 200);
    assert_eq!(
        page.header("content-security-policy"),
        Some(
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
    );
    assert_eq!(page.header("referrer-policy"), Some("no-referrer"));
    for path in ["/assets/app.js", "/api/projects"] {
        assert_eq!(
            server.get(path).header("referrer-policy"),
            Some("no-referrer"),
            "{path}"
        );
    }
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

// ------------------------------------------------------------------- docs

#[test]
fn a_new_project_has_a_docs_folder_and_its_project_file_names_no_docs_root() {
    let home = tempfile::tempdir().unwrap();
    let id = store(home.path()).create_project("alpha", t(0)).unwrap().id;
    let project = home.path().join("shared/projects").join(id.to_string());
    assert!(project.join("docs").is_dir());
    let file = std::fs::read_to_string(project.join("project.json")).unwrap();
    assert!(!file.contains("docsRoot"), "{file}");
    // A project file written before the Docs existed reads as it did.
    assert_eq!(store(home.path()).board(&id).unwrap().project.name, "alpha");
}

#[test]
fn starting_the_server_adds_a_missing_docs_folder_and_leaves_existing_ones_alone() {
    let (home, a, b) = two_projects();
    let projects = home.path().join("shared/projects");
    std::fs::remove_dir_all(projects.join(a.to_string()).join("docs")).unwrap();
    let kept = projects.join(b.to_string()).join("docs");
    std::fs::create_dir_all(kept.join("sub")).unwrap();
    std::fs::write(kept.join("sub/note.md"), "keep\r\n").unwrap();
    let server = Running::start(home.path());
    assert!(projects.join(a.to_string()).join("docs").is_dir());
    assert_eq!(
        std::fs::read_to_string(kept.join("sub/note.md")).unwrap(),
        "keep\r\n"
    );
    server.stop();
}

#[test]
fn the_list_names_each_projects_docs_folder() {
    let (home, a, _b) = two_projects();
    let server = Running::start(home.path());
    let body = server.get("/api/projects").json();
    let listed = body["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == a.to_string())
        .unwrap();
    let expected = std::path::absolute(
        home.path()
            .join("shared/projects")
            .join(a.to_string())
            .join("docs"),
    )
    .unwrap();
    assert_eq!(listed["docsPath"], expected.to_string_lossy().as_ref());
    assert!(std::path::Path::new(listed["docsPath"].as_str().unwrap()).is_absolute());
}

#[test]
fn changes_in_the_docs_folder_do_not_reload_the_board_or_send_changed() {
    let (home, a, _b) = two_projects();
    let server = Running::start(home.path());
    let docs = home
        .path()
        .join("shared/projects")
        .join(a.to_string())
        .join("docs");
    let board = format!("/api/projects/{a}/summary");
    let before = server.get(&board).json();
    let mut events = server.events();
    std::fs::create_dir_all(docs.join("product")).unwrap();
    std::fs::write(docs.join("product/tasks.md"), "# one\n").unwrap();
    std::fs::write(docs.join("product/tasks.md"), "# two\n").unwrap();
    std::fs::remove_file(docs.join("product/tasks.md")).unwrap();
    assert!(events.stays_quiet());
    assert_eq!(events.changed_count(), 0);
    let after = server.get(&board).json();
    assert_eq!(after["version"], before["version"]);
    assert_eq!(server.get("/api/projects").json()["catalogVersion"], {
        store(home.path()).catalog().unwrap().catalog_version
    });
}
