//! End-to-end stories for `agboard ls --all-projects`.
//!
//! Everything here runs the real `agboard` binary against the shared files in a temporary data area:
//! the CLI, a real `agboard serve` on port 0 for the web answer and the change notifications, and a
//! pseudo-terminal for the commands that need a person. The projects are built the way a user builds them
//! (create, add, move, report, answer, delete, create again), not by writing to the store directly.
//! `tests/all_projects_list.rs` covers the store and the argument rules in detail; these stories check the
//! whole path from the command line to the printed result.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tempfile::tempdir;

// ---------------------------------------------------------------- harness

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
}

fn run(home: &Path, args: &[&str]) -> Output {
    bin()
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

fn agboard(home: &Path, project: &str, args: &[&str]) -> Output {
    let mut full = vec!["--project", project];
    full.extend(args);
    run(home, &full)
}

/// A TASK.md body with `text` in its work section, which the file store accepts.
fn valid_body(text: &str) -> String {
    format!(
        "## 作業内容\n\n{text}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
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

fn stdout_text(output: &Output) -> String {
    ok(output);
    String::from_utf8(output.stdout.clone()).unwrap()
}

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

fn all(home: &Path, extra: &[&str]) -> Value {
    let mut args = vec!["ls", "--all-projects", "--json"];
    args.extend(extra);
    stdout_json(&run(home, &args))
}

fn all_text(home: &Path, extra: &[&str]) -> String {
    let mut args = vec!["ls", "--all-projects"];
    args.extend(extra);
    stdout_text(&run(home, &args))
}

/// One project's snapshot without the time it was fetched.
fn content(home: &Path, project: &str) -> Value {
    let mut snapshot = stdout_json(&agboard(home, project, &["snapshot", "--json"]));
    snapshot.as_object_mut().unwrap().remove("fetchedAt");
    snapshot
}

fn snapshot_of(home: &Path, project: &str) -> Value {
    stdout_json(&agboard(home, project, &["snapshot", "--json"]))
}

fn project_id(home: &Path, name: &str) -> String {
    stdout_json(&run(home, &["project", "ls", "--json"]))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == name)
        .unwrap_or_else(|| panic!("no project {name}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A rule that says which cards a filter should keep.
type Keep = Box<dyn Fn(&Value) -> bool>;

fn entry<'a>(list: &'a Value, name: &str) -> &'a Value {
    list["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["project"]["name"] == name)
        .unwrap_or_else(|| panic!("no project {name} in the list"))
}

fn card(project: &Value, id: i64) -> &Value {
    project["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no card #{id}"))
}

fn names_of(list: &Value) -> Vec<String> {
    list["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["project"]["name"].as_str().unwrap().to_string())
        .collect()
}

fn add(home: &Path, project: &str, title: &str, assignee: &str) {
    ok(&agboard(
        home,
        project,
        &[
            "add",
            title,
            "--assignee",
            assignee,
            "--actor",
            "human",
            "--desc",
            &valid_body(&format!("about {title}")),
        ],
    ));
}

fn mv(home: &Path, project: &str, id: &str, column: &str, actor: &str, reason: &str) {
    ok(&agboard(
        home,
        project,
        &["mv", id, column, "--actor", actor, "--reason", reason],
    ));
}

fn state(home: &Path, project: &str, id: &str, run_state: &str, reason: &str) {
    ok(&agboard(
        home,
        project,
        &["state", id, run_state, "--actor", "ai", "--reason", reason],
    ));
}

/// Every file in the data area, with its bytes except for the write-ahead log files that come and go with
/// any connection.
fn area(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            !name.ends_with("-wal") && !name.ends_with("-shm")
        })
        .filter(|e| e.path().is_file())
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                std::fs::read(e.path()).unwrap(),
            )
        })
        .collect();
    files.sort();
    files
}

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
        .env("SKAN_HOME", home)
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

impl Serve {
    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
        headers: &[(String, String)],
    ) -> (u16, String) {
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
        let mut response = agent.run(request).unwrap();
        (
            response.status().as_u16(),
            response.body_mut().read_to_string().unwrap_or_default(),
        )
    }

    fn token(&self) -> String {
        let page = self.request("GET", "/", None, &[]).1;
        let marker = "name=\"skan-token\" content=\"";
        let start = page.find(marker).expect("token meta tag") + marker.len();
        page[start..start + 64].to_string()
    }

    /// A write sent the way the board page sends it.
    fn write(&self, path: &str, body: &Value) -> (u16, String) {
        let headers = vec![
            ("Origin".to_string(), format!("http://{}", self.addr)),
            ("Sec-Fetch-Site".to_string(), "same-origin".to_string()),
            ("X-Skan-Token".to_string(), self.token()),
        ];
        self.request("POST", path, Some(body), &headers)
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
    fn pump(&mut self, within: Duration) {
        let deadline = Instant::now() + within;
        let mut chunk = [0u8; 4096];
        while Instant::now() < deadline {
            match self.stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => self
                    .received
                    .push_str(&String::from_utf8_lossy(&chunk[..n])),
                Err(_) => {}
            }
        }
    }

    fn wait_for(&mut self, needle: &str, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while Instant::now() < deadline && !self.received.contains(needle) {
            self.pump(Duration::from_millis(100));
        }
        self.received.contains(needle)
    }

    fn changed_count(&self) -> usize {
        self.received.matches("event: changed").count()
    }
}

/// Runs a command on a pseudo-terminal and answers its `[y/N]` prompt the way a person would.
#[cfg(unix)]
fn on_terminal(home: &Path, project: &str, answer: &str, args: &[&str]) -> i32 {
    use expectrl::process::unix::WaitStatus;
    use expectrl::{Eof, Expect};

    let mut command = bin();
    command
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(["--project", project])
        .args(args);
    let mut session = expectrl::Session::spawn(command).unwrap();
    session.set_expect_timeout(Some(Duration::from_secs(20)));
    session.expect("[y/N]").unwrap();
    session.send_line(answer).unwrap();
    session.expect(Eof).unwrap();
    match session.get_process().wait().unwrap() {
        WaitStatus::Exited(_, code) => code,
        other => panic!("unexpected end: {other:?}"),
    }
}

/// Three projects made in an order unlike their names, each with cards #1 and #2 of its own and a different
/// history: Mango has an AI card waiting for a decision, Apple's decision was answered in the web, Zebra has
/// finished work, and Kiwi has no cards at all.
fn build(home: &Path) {
    for name in ["Zebra", "Mango", "Kiwi", "Apple"] {
        ok(&run(home, &["project", "create", name]));
    }
    for name in ["Zebra", "Mango", "Apple"] {
        add(home, name, &format!("{name} build"), "ai");
        add(home, name, &format!("{name} review"), "human");
    }
    mv(home, "Mango", "1", "doing", "ai", "Mango starts");
    state(home, "Mango", "1", "pending", "Mango needs a decision");
    mv(home, "Zebra", "1", "doing", "ai", "Zebra starts");
    state(home, "Zebra", "1", "running", "Zebra works");
    mv(home, "Zebra", "1", "done", "human", "Zebra is done");
    mv(home, "Zebra", "2", "done", "human", "Zebra reviewed");
    mv(home, "Apple", "1", "doing", "ai", "Apple starts");
    state(home, "Apple", "1", "pending", "Apple needs a decision");

    // Apple's request is answered by a person in the web.
    let server = serve(home);
    let apple = snapshot_of(home, "Apple");
    let request = card(&apple, 1)["pendingRequestId"].as_str().unwrap();
    let (status, body) = server.write(
        &format!(
            "/api/projects/{}/cards/1/answer",
            apple["project"]["id"].as_str().unwrap()
        ),
        &json!({ "requestId": request, "text": "Apple: use the MIT license." }),
    );
    assert_eq!(status, 200, "{body}");
}

// ---------------------------------------------------------------- stories

#[test]
fn every_project_comes_back_by_name_with_the_same_content_as_its_own_snapshot() {
    let home = tempdir().unwrap();
    build(home.path());

    let list = all(home.path(), &[]);
    // The root: the time of the read, every project, and the catalog version.
    let root = list.as_object().unwrap();
    let mut keys: Vec<&String> = root.keys().collect();
    keys.sort();
    assert_eq!(keys, ["catalogVersion", "fetchedAt", "projects"]);
    assert!(list["fetchedAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        list["catalogRevision"],
        stdout_json(&run(home.path(), &["project", "ls", "--json"]))["catalogRevision"]
    );
    // By name, not by creation order.
    assert_eq!(names_of(&list), ["Apple", "Kiwi", "Mango", "Zebra"]);

    // Each entry is that project's snapshot, key for key, apart from the time it was fetched.
    for name in ["Apple", "Kiwi", "Mango", "Zebra"] {
        let own = content(home.path(), name);
        let listed = entry(&list, name);
        assert_eq!(listed, &own, "{name}");
        let keys: Vec<&String> = listed.as_object().unwrap().keys().collect();
        for key in [
            "project",
            "version",
            "cursor",
            "nextCardId",
            "cards",
            "problems",
        ] {
            assert!(keys.iter().any(|k| *k == key), "{name} lacks {key}");
        }
        assert_eq!(
            listed["project"]["id"],
            project_id(home.path(), name).as_str()
        );
        assert_eq!(
            listed["cursor"],
            format!(
                "f1:{}:{}",
                listed["project"]["id"].as_str().unwrap(),
                listed["version"].as_str().unwrap()
            )
            .as_str()
        );
    }

    // The same card number in several projects stays apart: each card belongs to its project and carries
    // only its own history.
    for name in ["Apple", "Mango", "Zebra"] {
        let listed = entry(&list, name);
        assert_eq!(card(listed, 1)["title"], format!("{name} build").as_str());
        assert_eq!(card(listed, 2)["title"], format!("{name} review").as_str());
        for c in listed["cards"].as_array().unwrap() {
            for event in c["history"].as_array().unwrap() {
                if let Some(reason) = event["reason"].as_str() {
                    assert!(
                        reason.starts_with(name),
                        "{name} #{} holds {reason:?}",
                        c["id"]
                    );
                }
            }
        }
    }
    let ids: Vec<&str> = list["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["project"]["id"].as_str().unwrap())
        .collect();
    let mut unique = ids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), ids.len());
    assert_ne!(
        card(entry(&list, "Mango"), 1)["history"],
        card(entry(&list, "Apple"), 1)["history"]
    );

    // The histories are whole: the web answer is in Apple's card, the waiting request in Mango's.
    let apple = card(entry(&list, "Apple"), 1);
    assert_eq!(apple["agentStatus"], "idle");
    assert!(apple["pendingRequestId"].is_null());
    let history = apple["history"].as_array().unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(history[3]["actor"], "human");
    assert_eq!(history[3]["reason"], "Apple: use the MIT license.");
    let mango = card(entry(&list, "Mango"), 1);
    assert_eq!(mango["agentStatus"], "pending");
    assert_eq!(mango["pendingReason"], "Mango needs a decision");
    assert_eq!(mango["history"].as_array().unwrap().len(), 3);
    // A project without cards is still there.
    assert_eq!(entry(&list, "Kiwi")["cards"], json!([]));
    assert_eq!(entry(&list, "Kiwi")["nextCardId"], 1);
}

#[test]
fn filters_apply_to_every_project_and_keep_the_projects_with_no_match() {
    let home = tempdir().unwrap();
    build(home.path());
    let full = all(home.path(), &[]);

    let cases: Vec<(Vec<&str>, Keep)> = vec![
        (
            vec!["--column", "done"],
            Box::new(|c| c["cardStatus"] == "done"),
        ),
        (
            vec!["--column", "todo"],
            Box::new(|c| c["cardStatus"] == "todo"),
        ),
        (
            vec!["--state", "pending"],
            Box::new(|c| c["agentStatus"] == "pending"),
        ),
        (
            vec!["--state", "running"],
            Box::new(|c| c["agentStatus"] == "running"),
        ),
        (
            vec!["--state", "idle"],
            Box::new(|c| c["agentStatus"] == "idle"),
        ),
        (
            vec!["--column", "doing", "--state", "pending"],
            Box::new(|c| c["cardStatus"] == "doing" && c["agentStatus"] == "pending"),
        ),
        (
            vec!["--column", "done", "--state", "pending"],
            Box::new(|c| c["cardStatus"] == "done" && c["agentStatus"] == "pending"),
        ),
    ];
    for (args, keep) in cases {
        let filtered = all(home.path(), &args);
        // Every project stays, in the same order, with its own project facts.
        assert_eq!(names_of(&filtered), names_of(&full), "{args:?}");
        for name in ["Apple", "Kiwi", "Mango", "Zebra"] {
            let want: Vec<Value> = entry(&full, name)["cards"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|c| keep(c))
                .cloned()
                .collect();
            let got = entry(&filtered, name);
            assert_eq!(got["cards"], Value::Array(want), "{name} {args:?}");
            for key in ["project", "version", "cursor"] {
                assert_eq!(got[key], entry(&full, name)[key], "{name} {args:?} {key}");
            }
            // Each project agrees with its own filtered `ls`.
            let mut own_args = vec!["ls", "--json"];
            own_args.extend(&args);
            let own = stdout_json(&agboard(home.path(), name, &own_args));
            assert_eq!(got["cards"], own["cards"], "{name} {args:?} own ls");
        }
    }

    // The numbers behind the cases above: one waiting card (Mango), nothing waiting elsewhere.
    let pending = all(home.path(), &["--state", "pending"]);
    let counts: Vec<usize> = pending["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["cards"].as_array().unwrap().len())
        .collect();
    assert_eq!(counts, [0, 0, 1, 0]);
    // A filter nothing matches leaves every project with an empty list.
    let none = all(home.path(), &["--column", "done", "--state", "pending"]);
    assert_eq!(none["projects"].as_array().unwrap().len(), 4);
    assert!(
        none["projects"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["cards"] == json!([]))
    );
    // A bad value is refused as every other `ls` refuses it.
    assert_error(
        &run(
            home.path(),
            &["--json", "ls", "--all-projects", "--column", "later"],
        ),
        "invalid_argument",
        2,
    );
}

#[cfg(unix)]
#[test]
fn a_deleted_project_leaves_the_list_and_a_new_one_with_the_same_name_starts_empty() {
    let home = tempdir().unwrap();
    build(home.path());
    let before = all(home.path(), &[]);
    let old_id = project_id(home.path(), "Mango");

    // Declining changes nothing; agreeing removes only Mango.
    assert_eq!(
        on_terminal(home.path(), "Mango", "n", &["project", "rm"]),
        0
    );
    assert_eq!(names_of(&all(home.path(), &[])), names_of(&before));
    assert_eq!(
        on_terminal(home.path(), "Mango", "y", &["project", "rm"]),
        0
    );
    let after = all(home.path(), &[]);
    assert_eq!(names_of(&after), ["Apple", "Kiwi", "Zebra"]);
    for name in ["Apple", "Kiwi", "Zebra"] {
        assert_eq!(entry(&after, name), entry(&before, name), "{name}");
        assert_eq!(entry(&after, name), &content(home.path(), name), "{name}");
    }
    assert_ne!(after["catalogVersion"], before["catalogVersion"]);

    // Created again under the old name, it is a different project with no cards and its own numbering.
    ok(&run(home.path(), &["project", "create", "Mango"]));
    let again = all(home.path(), &[]);
    assert_eq!(names_of(&again), ["Apple", "Kiwi", "Mango", "Zebra"]);
    let mango = entry(&again, "Mango");
    assert_ne!(mango["project"]["id"], old_id.as_str());
    assert_eq!(mango["cards"], json!([]));
    assert_eq!(mango["nextCardId"], 1);
    assert_eq!(mango, &content(home.path(), "Mango"));
    assert_eq!(entry(&again, "Apple"), entry(&before, "Apple"));
    assert_eq!(entry(&again, "Zebra"), entry(&before, "Zebra"));

    // Emptying one board keeps the project, with no cards, and moves its numbering on.
    assert_eq!(on_terminal(home.path(), "Zebra", "y", &["init"]), 0);
    let emptied = all(home.path(), &[]);
    assert_eq!(entry(&emptied, "Zebra")["cards"], json!([]));
    assert_eq!(entry(&emptied, "Zebra"), &content(home.path(), "Zebra"));
    assert_eq!(
        entry(&emptied, "Zebra")["project"]["id"],
        entry(&before, "Zebra")["project"]["id"]
    );
    assert_eq!(entry(&emptied, "Apple"), entry(&before, "Apple"));

    // Deleting every project leaves an empty list, not an error.
    for name in ["Apple", "Kiwi", "Mango", "Zebra"] {
        assert_eq!(on_terminal(home.path(), name, "y", &["project", "rm"]), 0);
    }
    let empty = all(home.path(), &[]);
    assert_eq!(empty["projects"], json!([]));
    assert_eq!(empty["catalogVersion"].as_str().unwrap().len(), 32);
}

#[test]
fn listing_changes_nothing_and_tells_a_running_server_nothing() {
    let home = tempdir().unwrap();
    build(home.path());
    let server = serve(home.path());
    let mut events = server.events();
    // Nothing has changed since the server started: no change event is pending.
    events.pump(Duration::from_millis(300));
    let heard = events.changed_count();
    let before = area(home.path());
    let worlds_before = all(home.path(), &[]);

    for args in [
        vec!["ls", "--all-projects"],
        vec!["ls", "--all-projects", "--json"],
        vec!["ls", "--all-projects", "--state", "pending", "--json"],
        vec!["ls", "--all-projects", "--column", "done"],
    ] {
        for _ in 0..3 {
            ok(&run(home.path(), &args));
        }
    }
    events.pump(Duration::from_millis(500));
    assert_eq!(events.changed_count(), heard, "a listing was announced");
    assert_eq!(area(home.path()), before, "a listing changed the data area");
    let mut again = all(home.path(), &[]);
    let mut first = worlds_before;
    first.as_object_mut().unwrap().remove("fetchedAt");
    again.as_object_mut().unwrap().remove("fetchedAt");
    assert_eq!(again, first);

    // The server still announces a real change afterwards, so the silence above was not a broken stream.
    add(home.path(), "Kiwi", "Kiwi first", "ai");
    assert!(events.wait_for("event: changed", Duration::from_secs(5)));
    assert_eq!(
        card(&all(home.path(), &[])["projects"][1], 1)["title"],
        "Kiwi first"
    );
}

#[test]
fn a_missing_data_area_lists_nothing_and_is_not_created_and_an_old_database_is_ignored() {
    let parent = tempdir().unwrap();
    let home = parent.path().join("not-yet");
    let list = all(&home, &[]);
    assert_eq!(list["projects"], json!([]));
    assert_eq!(list["catalogVersion"], "e3b0c44298fc1c149afbf4c8996fb924");
    assert!(list["fetchedAt"].is_string());
    let text = all_text(&home, &[]);
    assert!(text.contains("agboard project create"), "{text}");
    assert!(!home.exists(), "listing created the data area");

    // An existing, empty directory stays empty.
    let empty = tempdir().unwrap();
    assert_eq!(all(empty.path(), &[])["projects"], json!([]));
    assert_eq!(std::fs::read_dir(empty.path()).unwrap().count(), 0);
}

#[test]
fn a_listing_is_one_moment_even_while_another_command_keeps_changing_two_projects() {
    let home = tempdir().unwrap();
    for name in ["North", "South"] {
        ok(&run(home.path(), &["project", "create", name]));
    }
    // A running server shares the data area, as in daily use.
    let server = serve(home.path());
    let _ = &server;

    let done = Arc::new(AtomicBool::new(false));
    let writer = {
        let done = done.clone();
        let path = home.path().to_path_buf();
        std::thread::spawn(move || {
            // One card at a time, North then South: any consistent moment has North equal to South or one
            // ahead. A reader that took the projects at different moments could see South ahead of North.
            for i in 0..25 {
                add(&path, "North", &format!("n{i}"), "ai");
                add(&path, "South", &format!("s{i}"), "ai");
            }
            done.store(true, Ordering::SeqCst);
        })
    };
    let mut reads = 0;
    while !done.load(Ordering::SeqCst) || reads < 5 {
        let list = all(home.path(), &[]);
        let north = entry(&list, "North");
        let south = entry(&list, "South");
        let (n, s) = (
            // The card counts stand in for the revisions: each save adds one card.
            north["cards"].as_array().unwrap().len() as i64,
            south["cards"].as_array().unwrap().len() as i64,
        );
        assert!(n - s == 0 || n - s == 1, "North {n} and South {s}");
        assert_eq!(north["cards"].as_array().unwrap().len() as i64, n);
        assert_eq!(south["cards"].as_array().unwrap().len() as i64, s);
        // Each project's history: one event per card.
        for c in north["cards"].as_array().unwrap() {
            assert_eq!(c["history"].as_array().unwrap().len(), 1);
        }
        reads += 1;
        if reads > 400 {
            break;
        }
    }
    writer.join().unwrap();
    assert!(reads >= 5);
    let last = all(home.path(), &[]);
    assert_eq!(entry(&last, "North")["cards"].as_array().unwrap().len(), 25);
    assert_eq!(entry(&last, "South")["cards"].as_array().unwrap().len(), 25);
}

#[test]
fn only_a_list_may_ask_for_every_project_and_never_together_with_a_project() {
    let home = tempdir().unwrap();
    build(home.path());
    let before = area(home.path());

    // Both at once, in any position.
    for args in [
        vec!["--json", "--project", "Apple", "ls", "--all-projects"],
        vec!["--json", "ls", "--all-projects", "--project", "Apple"],
        vec!["--json", "ls", "--project=Apple", "--all-projects"],
        vec!["--json", "ls", "--all-projects", "--project", "Nowhere"],
    ] {
        assert_error(&run(home.path(), &args), "invalid_argument", 2);
    }
    // Any other command.
    for args in [
        vec!["--json", "--project", "Apple", "snapshot", "--all-projects"],
        vec![
            "--json",
            "--project",
            "Apple",
            "show",
            "1",
            "--all-projects",
        ],
        vec![
            "--json",
            "--project",
            "Apple",
            "workspace",
            "--all-projects",
        ],
        vec!["--json", "--project", "Apple", "add", "x", "--all-projects"],
        vec!["--json", "project", "ls", "--all-projects"],
        vec!["--json", "serve", "--all-projects"],
        vec!["--json", "--all-projects", "ls"],
    ] {
        assert_error(&run(home.path(), &args), "invalid_argument", 2);
    }
    // Without the flag nothing is guessed: a list, every writing command and every command about one project
    // still need --project.
    for args in [
        vec!["--json", "ls"],
        vec!["--json", "ls", "--state", "pending"],
        vec!["--json", "snapshot"],
        vec!["--json", "show", "1"],
        vec!["--json", "add", "x", "--assignee", "ai", "--actor", "ai"],
        vec![
            "--json", "mv", "1", "doing", "--actor", "ai", "--reason", "r",
        ],
        vec![
            "--json", "state", "1", "idle", "--actor", "ai", "--reason", "r",
        ],
        vec!["--json", "rm", "1"],
        vec!["--json", "init"],
        vec!["--json", "wait", "--after", "0:0"],
    ] {
        assert_error(&run(home.path(), &args), "invalid_argument", 2);
    }
    // Every refusal left the data alone.
    assert_eq!(area(home.path()), before);
    // And the plain way of listing one project still works.
    let own = stdout_json(&agboard(home.path(), "Apple", &["ls", "--json"]));
    assert_eq!(own["cards"].as_array().unwrap().len(), 2);
}

#[test]
fn the_text_listing_shows_each_project_under_its_name_with_the_columns_of_ls() {
    let home = tempdir().unwrap();
    build(home.path());

    let text = all_text(home.path(), &[]);
    // A heading per project, in name order, separated by a blank line.
    let headings: Vec<&str> = text
        .lines()
        .filter(|l| l.starts_with("Project: "))
        .collect();
    assert_eq!(
        headings,
        [
            "Project: Apple",
            "Project: Kiwi",
            "Project: Mango",
            "Project: Zebra"
        ]
    );
    // Under each heading is what `--project NAME ls` prints for that project.
    let mut expected = Vec::new();
    for name in ["Apple", "Kiwi", "Mango", "Zebra"] {
        let own = stdout_text(&agboard(home.path(), name, &["ls"]));
        expected.push(format!("Project: {name}\n{own}"));
    }
    assert_eq!(text.trim_end(), expected.join("\n").trim_end());
    assert!(text.contains("#1 Mango build [AI] [pending: Mango needs a decision]"));
    assert!(text.contains("#2 Zebra review [User]"));
    // A project without cards still shows the three columns.
    assert!(text.contains("Project: Kiwi\nTodo\nDoing\nDone\n"));

    // The filters show the same headings with fewer cards.
    let pending = all_text(home.path(), &["--state", "pending"]);
    assert_eq!(pending.matches("Project: ").count(), 4);
    assert_eq!(pending.matches("  #").count(), 1);
    assert!(pending.contains("Mango needs a decision"));

    // No projects: a pointer to the next step instead of an empty screen.
    let none = tempdir().unwrap();
    let guide = all_text(none.path(), &[]);
    assert!(guide.contains("No projects."), "{guide}");
    assert!(guide.contains("agboard project create NAME"), "{guide}");
    assert!(!guide.contains("Project:"), "{guide}");

    // The help shows how to ask for it.
    let help = stdout_text(&run(home.path(), &["ls", "--help"]));
    assert!(help.contains("--all-projects"), "{help}");
    assert!(help.contains("agboard ls --all-projects"), "{help}");
    let top = stdout_text(&run(home.path(), &["--help"]));
    assert!(top.contains("agboard ls --all-projects --json"), "{top}");
}
