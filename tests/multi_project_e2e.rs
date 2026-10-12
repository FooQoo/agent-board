//! End-to-end stories for a data area that holds several projects.
//!
//! Everything here runs the real `agboard` binary against the shared files in a temporary data area:
//! the CLI, a real `agboard serve` on port 0 with HTTP and server-sent events, the agent hook and `wait`,
//! and a pseudo-terminal for the commands that need a person. The projects come from the backup fixtures
//! the browser specs use (`e2e/fixtures/multi-project-*.json`), which hold a card #1 each with different
//! content.

mod common;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tempfile::tempdir;

// ---------------------------------------------------------------- harness

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("e2e")
        .join("fixtures")
        .join(name)
}

/// `agboard [--project NAME] ARGS...` with no terminal and nothing on stdin.
fn run(home: &Path, project: Option<&str>, args: &[&str]) -> Output {
    let mut command = bin();
    command.env("AGBOARD_HOME", home).env("TZ", "UTC");
    if let Some(project) = project {
        command.args(["--project", project]);
    }
    command.args(args).stdin(Stdio::null()).output().unwrap()
}

fn agboard(home: &Path, project: &str, args: &[&str]) -> Output {
    run(home, Some(project), args)
}

fn ok(output: &Output) {
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn stdout_json(output: &Output) -> Value {
    ok(output);
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout is not JSON: {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

/// The `{"error": {...}}` a failed command printed on stderr when it was run with `--json`.
fn error_of(output: &Output) -> Value {
    assert!(!output.status.success(), "the command should have failed");
    serde_json::from_slice::<Value>(&output.stderr).unwrap_or_else(|_| {
        panic!(
            "stderr is not JSON: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })["error"]
        .clone()
}

fn assert_error(output: &Output, code: &str, exit: i32) {
    assert_eq!(output.status.code(), Some(exit), "{output:?}");
    assert_eq!(error_of(output)["code"], code, "{output:?}");
}

/// Build the project from a backup fixture on the shared files: the cards in
/// their order, with their lane and run state. Pending requests are not
/// replayed as a reason-only request.
fn import_fixture(home: &Path, project: &str, file: &str) {
    let backup: Value = serde_json::from_slice(&std::fs::read(fixture(file)).unwrap()).unwrap();
    ok(&run(home, None, &["project", "create", project]));
    for card in backup["cards"].as_array().unwrap() {
        let body = valid_body(card["description"].as_str().unwrap());
        let assignee = card["assignee"].as_str().unwrap();
        ok(&agboard(
            home,
            project,
            &[
                "add",
                card["title"].as_str().unwrap(),
                "--assignee",
                assignee,
                "--actor",
                "human",
                "--desc",
                &body,
            ],
        ));
        let id = card["id"].as_i64().unwrap().to_string();
        let lane = card["cardStatus"].as_str().unwrap();
        if lane != "todo" {
            ok(&agboard(
                home,
                project,
                &["mv", &id, lane, "--actor", "human", "--reason", "fixture"],
            ));
        }
        let state = card["agentStatus"].as_str().unwrap();
        if state == "running" || state == "pending" {
            let reason = card["pendingReason"].as_str().unwrap_or("fixture");
            let request = common::decision_json(reason);
            let args: Vec<&str> = if state == "pending" {
                vec![
                    "state",
                    &id,
                    state,
                    "--actor",
                    "ai",
                    "--request-json",
                    &request,
                ]
            } else {
                vec!["state", &id, state, "--actor", "ai", "--reason", reason]
            };
            ok(&agboard(home, project, &args));
        }
    }
}

/// A TASK.md body with `text` in its work section, which the file store accepts.
fn valid_body(text: &str) -> String {
    format!(
        "## 作業内容\n\n{text}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
}

/// Alpha and Beta from the fixtures: each has a card #1 with its own content.
fn two_projects(home: &Path) {
    import_fixture(home, "Alpha", "multi-project-a.json");
    import_fixture(home, "Beta", "multi-project-b.json");
}

/// The request ID that card `id` of `project` is waiting on, as the board names it.
fn pending_request(home: &Path, project: &str, id: i64) -> String {
    snapshot(home, project)["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["id"] == id)
        .unwrap()["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string()
}

fn snapshot(home: &Path, project: &str) -> Value {
    stdout_json(&agboard(home, project, &["snapshot", "--json"]))
}

/// The snapshot without the time it was fetched, for comparing contents.
fn content(mut snapshot: Value) -> Value {
    snapshot.as_object_mut().unwrap().remove("fetchedAt");
    snapshot
}

fn project_id(home: &Path, name: &str) -> String {
    stdout_json(&run(home, None, &["project", "ls", "--json"]))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|project| project["name"] == name)
        .unwrap_or_else(|| panic!("no project {name}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn project_names(home: &Path) -> Vec<String> {
    stdout_json(&run(home, None, &["project", "ls", "--json"]))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|project| project["name"].as_str().unwrap().to_string())
        .collect()
}

fn card(snapshot: &Value, id: i64) -> &Value {
    snapshot["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["id"] == id)
        .unwrap_or_else(|| panic!("no card #{id}"))
}

/// A running `agboard serve --port 0`, stopped when dropped so that a failing test leaves nothing behind.
struct Serve {
    child: Child,
    addr: SocketAddr,
}

impl Drop for Serve {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn serve(home: &Path) -> Serve {
    let mut child = bin()
        .env("AGBOARD_HOME", home)
        .args(["serve", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let url = line
        .split_whitespace()
        .find(|word| word.starts_with("http://127.0.0.1:"))
        .unwrap_or_else(|| panic!("no address in {line:?}"));
    let addr: SocketAddr = url
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .parse()
        .unwrap();
    Serve { child, addr }
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

impl Serve {
    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
        headers: &[(String, String)],
    ) -> Reply {
        let mut builder = ureq::http::Request::builder()
            .method(method)
            .uri(format!("http://{}{path}", self.addr));
        if body.is_some() {
            builder = builder.header("Content-Type", "application/json");
        }
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .into();
        let request = builder
            .body(body.map(Value::to_string).unwrap_or_default())
            .unwrap();
        // A refused write is answered before its body is read and the connection is closed, so on macOS the
        // client can see the reset (an I/O error such as EINVAL) while it is still sending. Ask again.
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
        Reply {
            status: response.status().as_u16(),
            body: response.body_mut().read_to_string().unwrap_or_default(),
        }
    }

    fn get(&self, path: &str) -> Reply {
        self.request("GET", path, None, &[])
    }

    fn token(&self) -> String {
        let page = self.get("/").body;
        let marker = "name=\"agboard-token\" content=\"";
        let start = page.find(marker).expect("token meta tag") + marker.len();
        page[start..start + 64].to_string()
    }

    /// A write sent the way the board page sends it: same origin, with the page's token.
    fn write(&self, method: &str, path: &str, body: Option<&Value>) -> Reply {
        let headers = vec![
            ("Origin".to_string(), format!("http://{}", self.addr)),
            ("Sec-Fetch-Site".to_string(), "same-origin".to_string()),
            ("X-Agboard-Token".to_string(), self.token()),
        ];
        self.request(method, path, body, &headers)
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
        assert!(events.wait_for("event: ready", Duration::from_secs(5)));
        events
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
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => break,
            }
        }
        self.received.contains(needle)
    }

    /// Waits until at least `count` changed events have arrived in all.
    fn wait_for_changes(&mut self, count: usize, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline {
            if self.changed_count() >= count {
                return true;
            }
            let mut chunk = [0u8; 4096];
            if let Ok(n) = self.stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                self.received
                    .push_str(&String::from_utf8_lossy(&chunk[..n]));
            }
        }
        self.changed_count() >= count
    }

    fn changed_count(&self) -> usize {
        self.received.matches("event: changed").count()
    }
}

/// Waits for `child` for at most `limit`; kills it and fails when it is still running.
fn finish(mut child: Child, limit: Duration) -> Output {
    let began = Instant::now();
    loop {
        if child.try_wait().unwrap().is_some() {
            return child.wait_with_output().unwrap();
        }
        if began.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the command did not end within {limit:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn spawn_wait(home: &Path, project: &str, after: &str, timeout: Option<&str>) -> Child {
    let mut command = bin();
    command.env("AGBOARD_HOME", home).args([
        "--project",
        project,
        "--json",
        "wait",
        "--after",
        after,
    ]);
    if let Some(timeout) = timeout {
        command.args(["--timeout", timeout]);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn still_running(child: &mut Child, for_how_long: Duration) -> bool {
    std::thread::sleep(for_how_long);
    child.try_wait().unwrap().is_none()
}

fn hook(home: &Path, project: &str, agent: &str) -> String {
    let mut child = bin()
        .env("AGBOARD_HOME", home)
        .args(["--project", project, "hook", "--agent", agent])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"SessionStart"}"#)
        .unwrap();
    let output = child.wait_with_output().unwrap();
    ok(&output);
    let parsed: Value = serde_json::from_slice(&output.stdout).unwrap();
    parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_string()
}

/// What a person would see across the whole data area: the catalog and every project's snapshot.
fn world(home: &Path) -> Value {
    let catalog = stdout_json(&run(home, None, &["project", "ls", "--json"]));
    let mut projects = serde_json::Map::new();
    for project in catalog["projects"].as_array().unwrap() {
        let name = project["name"].as_str().unwrap();
        projects.insert(name.to_string(), content(snapshot(home, name)));
    }
    json!({ "catalog": catalog, "projects": projects })
}

/// Runs a command on a pseudo-terminal and answers its `[y/N]` prompt the way a person would.
/// Returns the exit code and what was printed.
#[cfg(unix)]
fn on_terminal(home: &Path, project: &str, answer: &str, args: &[&str]) -> (i32, String) {
    use expectrl::process::unix::WaitStatus;
    use expectrl::{Eof, Expect};

    let mut command = bin();
    command
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["--project", project])
        .args(args);
    let mut session = expectrl::Session::spawn(command).unwrap();
    session.set_expect_timeout(Some(Duration::from_secs(20)));
    session.expect("[y/N]").unwrap();
    session.send_line(answer).unwrap();
    let rest = session.expect(Eof).unwrap();
    let printed = String::from_utf8_lossy(rest.as_bytes()).into_owned();
    let code = match session.get_process().wait().unwrap() {
        WaitStatus::Exited(_, code) => code,
        other => panic!("unexpected end: {other:?}"),
    };
    (code, printed)
}

// ---------------------------------------------------------------- stories

#[test]
fn a_new_data_area_starts_with_no_projects_and_projects_are_managed_by_name() {
    let home = tempdir().unwrap();

    // Listing in a data area that does not exist yet shows nothing and creates nothing.
    let listed = stdout_json(&run(home.path(), None, &["project", "ls", "--json"]));
    assert_eq!(
        listed,
        json!({ "projects": [], "catalogVersion": "e3b0c44298fc1c149afbf4c8996fb924" })
    );

    // The server starts with zero projects.
    let server = serve(home.path());
    let reply = server.get("/api/projects");
    assert_eq!(reply.status, 200);
    assert_eq!(
        reply.json(),
        json!({ "projects": [], "catalogVersion": "e3b0c44298fc1c149afbf4c8996fb924" })
    );

    // Projects are created by the CLI, listed by name, and seen by the running server.
    ok(&run(home.path(), None, &["project", "create", "Beta"]));
    ok(&run(home.path(), None, &["project", "create", "Alpha"]));
    assert_eq!(project_names(home.path()), ["Alpha", "Beta"]);
    let served: Vec<String> = server.get("/api/projects").json()["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|project| project["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(served, ["Alpha", "Beta"]);

    // The same name is refused for create and rename, and nothing changes.
    let before = world(home.path());
    assert_error(
        &run(home.path(), None, &["--json", "project", "create", "Alpha"]),
        "project_name_exists",
        2,
    );
    assert_error(
        &agboard(
            home.path(),
            "Beta",
            &["--json", "project", "rename", "Alpha"],
        ),
        "project_name_exists",
        2,
    );
    assert_eq!(world(home.path()), before);

    // A rename keeps the ID; the old name no longer finds the project.
    let beta_id = project_id(home.path(), "Beta");
    ok(&agboard(
        home.path(),
        "Beta",
        &["project", "rename", "Gamma"],
    ));
    assert_eq!(project_id(home.path(), "Gamma"), beta_id);
    assert_error(
        &agboard(home.path(), "Beta", &["--json", "snapshot"]),
        "project_not_found",
        4,
    );
}

#[test]
fn every_command_that_works_on_a_project_refuses_to_guess_one() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let server = serve(home.path());
    let before = world(home.path());

    let commands: Vec<Vec<&str>> = vec![
        vec!["ls"],
        vec!["show", "1"],
        vec!["snapshot"],
        vec!["add", "x", "--assignee", "ai", "--actor", "ai"],
        vec!["edit", "1", "--title", "x"],
        vec!["mv", "1", "doing", "--actor", "human", "--reason", "x"],
        vec!["state", "1", "running", "--actor", "ai", "--reason", "x"],
        vec!["rm", "1"],
        vec!["init"],
        vec!["workspace"],
        vec!["hook", "--agent", "claude"],
        vec![
            "wait",
            "--after",
            "0123456789abcdef0123456789abcdef:1",
            "--timeout",
            "1",
        ],
        vec!["project", "rename", "X"],
        vec!["project", "rm"],
    ];
    for args in commands {
        // Not the environment, not a project the server shows, not the current directory.
        let mut command = bin();
        command
            .env("AGBOARD_HOME", home.path())
            .env("AGBOARD_PROJECT", "Alpha")
            .current_dir(home.path())
            .arg("--json")
            .args(&args)
            .stdin(Stdio::null());
        let output = command.output().unwrap();
        if args[0] == "hook" {
            // A hook never fails the agent's turn: it reports the error in its output and hands over no board.
            ok(&output);
            let text = String::from_utf8_lossy(&output.stdout).into_owned();
            assert!(text.contains("AGBOARD_ERROR"), "{text}");
            assert!(!text.contains("AGBOARD_SNAPSHOT"), "{text}");
            continue;
        }
        if args.first() == Some(&"wait") {
            // A cursor of the old form is refused while the arguments are read (exit 2).
            assert_eq!(output.status.code(), Some(2), "{args:?}");
            continue;
        }
        assert_error(&output, "invalid_argument", 2);
        assert!(
            error_of(&output)["message"]
                .as_str()
                .unwrap()
                .contains("--project"),
            "{args:?}"
        );
    }
    // The commands that are for the whole data area do not take a project.
    assert_error(
        &agboard(home.path(), "Alpha", &["--json", "project", "ls"]),
        "invalid_argument",
        2,
    );
    assert_error(
        &agboard(home.path(), "Alpha", &["--json", "project", "create", "Z"]),
        "invalid_argument",
        2,
    );
    assert_error(
        &agboard(home.path(), "Alpha", &["--json", "serve", "--port", "0"]),
        "invalid_argument",
        2,
    );
    // An unknown name is not found either.
    assert_error(
        &agboard(home.path(), "Nope", &["--json", "snapshot"]),
        "project_not_found",
        4,
    );
    assert_eq!(world(home.path()), before);
    drop(server);
}

#[test]
fn the_server_writes_only_where_the_url_points_and_tells_browsers_what_changed() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let server = serve(home.path());
    let alpha_id = project_id(home.path(), "Alpha");
    let beta_id = project_id(home.path(), "Beta");

    // Each project's board has its own cards, with their full history.
    let alpha_board = server
        .get(&format!("/api/projects/{alpha_id}/board"))
        .json();
    let beta_board = server.get(&format!("/api/projects/{beta_id}/board")).json();
    assert_eq!(alpha_board["project"]["name"], "Alpha");
    assert_eq!(beta_board["project"]["name"], "Beta");
    assert_eq!(
        card(&alpha_board, 1)["title"],
        "Alpha: draft the release notes"
    );
    assert_eq!(
        card(&beta_board, 1)["title"],
        "Beta: benchmark the importer"
    );
    assert_eq!(
        card(&alpha_board, 2)["history"].as_array().unwrap().len(),
        3
    );

    // The browser's connection hears about changes by the CLI, in either project.
    let mut events = server.events();
    ok(&agboard(
        home.path(),
        "Beta",
        &["edit", "1", "--title", "Beta: renamed card"],
    ));
    assert!(events.wait_for("event: changed", Duration::from_secs(5)));
    let heard = events.changed_count();

    // A write that is refused (no token) neither changes anything nor is announced.
    let before = world(home.path());
    let reply = server.request(
        "POST",
        &format!("/api/projects/{alpha_id}/cards"),
        Some(&json!({ "title": "x", "description": "", "assignee": "ai" })),
        &[],
    );
    assert_eq!(reply.status, 403);
    assert_eq!(world(home.path()), before);

    // An unknown project is 404 and a malformed ID is 422; neither creates anything.
    let missing = server.get("/api/projects/00000000000000000000000000000000/board");
    assert_eq!(
        (missing.status, missing.code()),
        (404, "project_not_found".into())
    );
    let malformed = server.get("/api/projects/not-an-id/board");
    assert_eq!(
        (malformed.status, malformed.code()),
        (422, "invalid_value".into())
    );
    let reply = server.write(
        "POST",
        "/api/projects/00000000000000000000000000000000/cards",
        Some(&json!({ "title": "x", "description": "", "assignee": "ai" })),
    );
    assert_eq!(reply.status, 404);
    assert_eq!(world(home.path()), before);
    assert_eq!(events.changed_count(), heard);

    // The web moves a card of Alpha with a reason; Beta keeps every byte.
    let beta = content(snapshot(home.path(), "Beta"));
    let reply = server.write(
        "POST",
        &format!("/api/projects/{alpha_id}/cards/1/move"),
        Some(&json!({ "cardStatus": "doing", "reason": "Starting the notes." })),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(events.wait_for_changes(heard + 1, Duration::from_secs(5)));
    assert_eq!(content(snapshot(home.path(), "Beta")), beta);
    let moved = snapshot(home.path(), "Alpha");
    assert_eq!(card(&moved, 1)["cardStatus"], "doing");
    assert_eq!(
        card(&moved, 1)["history"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["actor"],
        "human"
    );

    // A renamed project keeps its ID, so a page that holds the ID keeps working.
    ok(&agboard(
        home.path(),
        "Alpha",
        &["project", "rename", "Alpha Renamed"],
    ));
    // The rename is on disk now; the board shows it once the watcher has read it.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let renamed = loop {
        let board = server
            .get(&format!("/api/projects/{alpha_id}/board"))
            .json();
        if board["project"]["name"] == "Alpha Renamed" || std::time::Instant::now() > deadline {
            break board;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    assert_eq!(renamed["project"]["name"], "Alpha Renamed");

    // A project deleted and made again under the same name is a different project: the old ID is gone and
    // a write to it reaches nobody.
    #[cfg(unix)]
    {
        let (code, _) = on_terminal(home.path(), "Alpha Renamed", "y", &["project", "rm"]);
        assert_eq!(code, 0);
        ok(&run(
            home.path(),
            None,
            &["project", "create", "Alpha Renamed"],
        ));
        let new_id = project_id(home.path(), "Alpha Renamed");
        assert_ne!(new_id, alpha_id);
        let old = server.get(&format!("/api/projects/{alpha_id}/board"));
        assert_eq!((old.status, old.code()), (404, "project_not_found".into()));
        let reply = server.write(
            "POST",
            &format!("/api/projects/{alpha_id}/cards"),
            Some(&json!({ "title": "late", "description": "", "assignee": "ai" })),
        );
        assert_eq!(reply.status, 404);
        // A project created on the shared files appears on the board once the watcher reads it.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let fresh = loop {
            let board = server.get(&format!("/api/projects/{new_id}/board")).json();
            if board["cards"].is_array() || std::time::Instant::now() > deadline {
                break board;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        assert_eq!(fresh["cards"], json!([]));
        assert_eq!(content(snapshot(home.path(), "Beta")), beta);
    }
}

#[test]
fn hook_and_wait_follow_one_project_from_a_web_answer_to_the_resumed_agent() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let server = serve(home.path());
    let alpha_id = project_id(home.path(), "Alpha");

    // The hook hands over all of Alpha and nothing of Beta, for both agents.
    for agent in ["claude", "codex"] {
        let context = hook(home.path(), "Alpha", agent);
        assert!(context.starts_with("AGBOARD_SNAPSHOT\n"), "{agent}");
        assert!(context.contains("Alpha: choose the license"), "{agent}");
        assert!(context.contains("Alpha: set up the repository"), "{agent}");
        assert!(
            context.contains("Which license should Alpha use?"),
            "{agent}"
        );
        assert!(!context.contains("Beta"), "{agent}: {context}");
        let snapshot: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
        assert_eq!(snapshot["project"]["id"], alpha_id.as_str());
        assert_eq!(snapshot["cards"].as_array().unwrap().len(), 3);
    }
    assert!(!hook(home.path(), "Beta", "claude").contains("Alpha"));

    // The agent waits on Alpha. A change to Beta does not end the wait; the person's answer in the web does.
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let mut waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    ok(&agboard(
        home.path(),
        "Beta",
        &["edit", "1", "--title", "Beta changes meanwhile"],
    ));
    ok(&agboard(
        home.path(),
        "Beta",
        &[
            "state",
            "3",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &common::decision_json("Beta asks as well"),
        ],
    ));
    assert!(
        still_running(&mut waiter, Duration::from_millis(1500)),
        "a change to another project must not end the wait"
    );
    let reply = server.write(
        "POST",
        &format!("/api/projects/{alpha_id}/cards/2/answer"),
        Some(&json!({ "requestId": pending_request(home.path(), "Alpha", 2), "text": "Use the MIT license." })),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    let output = finish(waiter, Duration::from_secs(15));
    let received = stdout_json(&output);
    assert_eq!(received["project"]["id"], alpha_id.as_str());
    assert_eq!(received["project"]["name"], "Alpha");
    assert_eq!(card(&received, 2)["agentStatus"], "idle");
    let history = card(&received, 2)["history"].as_array().unwrap().clone();
    assert_eq!(history.last().unwrap()["reason"], "Use the MIT license.");
    assert_eq!(history.last().unwrap()["actor"], "human");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("Beta"));

    // The agent resumes from the answer it was given, and the next hook shows the whole new history.
    ok(&agboard(
        home.path(),
        "Alpha",
        &[
            "state",
            "2",
            "running",
            "--actor",
            "ai",
            "--reason",
            "Resuming with the MIT license.",
        ],
    ));
    let context = hook(home.path(), "Alpha", "claude");
    assert!(context.contains("Use the MIT license."));
    assert!(context.contains("Resuming with the MIT license."));
    assert!(!context.contains("Beta"));

    // A rename while waiting keeps the same project and returns its latest snapshot.
    let after = snapshot(home.path(), "Alpha")["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let waiter = spawn_wait(home.path(), "Alpha", &after, None);
    std::thread::sleep(Duration::from_millis(500));
    ok(&agboard(
        home.path(),
        "Alpha",
        &["project", "rename", "Alpha Two"],
    ));
    ok(&agboard(
        home.path(),
        "Alpha Two",
        &[
            "add",
            "After the rename",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    ));
    let received = stdout_json(&finish(waiter, Duration::from_secs(15)));
    assert_eq!(received["project"]["id"], alpha_id.as_str());
    assert_eq!(received["project"]["name"], "Alpha Two");
    // The addition itself is in the project the wait followed (the wait may have ended at the rename).
    assert_eq!(
        card(&snapshot(home.path(), "Alpha Two"), 4)["title"],
        "After the rename"
    );

    // Deleting the project ends the wait with an error, and a project made later with the same name is not
    // followed; the old cursor is not valid for it either.
    #[cfg(unix)]
    {
        let after = snapshot(home.path(), "Alpha Two")["cursor"]
            .as_str()
            .unwrap()
            .to_string();
        let waiter = spawn_wait(home.path(), "Alpha Two", &after, None);
        std::thread::sleep(Duration::from_millis(500));
        let (code, _) = on_terminal(home.path(), "Alpha Two", "y", &["project", "rm"]);
        assert_eq!(code, 0);
        let output = finish(waiter, Duration::from_secs(15));
        assert_error(&output, "project_not_found", 4);
        assert!(output.stdout.is_empty());

        ok(&run(home.path(), None, &["project", "create", "Alpha Two"]));
        ok(&agboard(
            home.path(),
            "Alpha Two",
            &["add", "New project", "--assignee", "ai", "--actor", "ai"],
        ));
        let output = finish(
            spawn_wait(home.path(), "Alpha Two", &after, Some("2")),
            Duration::from_secs(15),
        );
        assert_error(&output, "cursor_invalid", 1);
    }
}
