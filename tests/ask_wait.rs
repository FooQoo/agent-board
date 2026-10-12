//! `state ... pending --request-json '{..., "wait": {"timeoutSeconds": N}}'`: ask a decision and wait for its
//! answer in one command.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::tempdir;

/// A question with two choices and the given `wait` value (`None` leaves the key out).
fn question(wait: Option<&str>) -> String {
    let wait = wait.map(|w| format!(r#","wait":{w}"#)).unwrap_or_default();
    format!(
        r#"{{"question":"Which plan?","choices":[{{"id":"a","label":"Plan A"}},{{"id":"b","label":"Plan B"}}]{wait}}}"#
    )
}

fn command(home: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_agboard"));
    command
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["--project", "Agent Board"])
        .args(args);
    command
}

fn agboard(home: &Path, args: &[&str]) -> Output {
    command(home, args).output().unwrap()
}

fn start_server(home: &Path) -> Child {
    let mut server = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .args(["serve", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(server.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert!(line.contains("http://127.0.0.1:"), "{line}");
    server
}

/// A board with one AI card in todo.
fn board(home: &Path) {
    assert!(agboard(home, &["init"]).status.success());
    assert!(
        agboard(home, &["add", "Ask", "--assignee", "ai", "--actor", "ai"])
            .status
            .success()
    );
}

fn card(home: &Path) -> Value {
    let shown = agboard(home, &["show", "1", "--json"]);
    serde_json::from_slice::<Value>(&shown.stdout).unwrap()["card"].clone()
}

/// The pending request ID once the card has asked.
fn wait_for_request(home: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(id) = card(home)["pendingRequestId"].as_str() {
            return id.to_string();
        }
        assert!(Instant::now() < deadline, "the card never became pending");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn ask_and_wait(home: &Path, timeout_seconds: u64) -> Child {
    let wait = format!(r#"{{"timeoutSeconds":{timeout_seconds}}}"#);
    command(
        home,
        &[
            "--json",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &question(Some(&wait)),
        ],
    )
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .unwrap()
}

fn stop(mut server: Child) {
    let _ = server.kill();
    let _ = server.wait();
}

#[test]
fn the_answer_comes_back_when_the_request_is_answered() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let waiter = ask_and_wait(home.path(), 30);
    let request = wait_for_request(home.path());
    let answered = agboard(
        home.path(),
        &[
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "a",
            "--reason",
            "Go ahead.",
        ],
    );
    assert!(answered.status.success());
    let output = waiter.wait_with_output().unwrap();
    stop(server);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(reply["answer"]["choiceId"], "a");
    assert_eq!(reply["answer"]["choiceLabel"], "Plan A");
    assert_eq!(reply["answer"]["text"], "Go ahead.");
    assert_eq!(reply["card"]["agentStatus"], "idle");
    assert_eq!(reply["card"]["cardStatus"], "todo");
}

#[test]
fn a_timeout_is_not_an_answer_and_the_request_stays() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let output = ask_and_wait(home.path(), 1).wait_with_output().unwrap();
    stop(server);
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "wait_timeout");
    assert_eq!(card(home.path())["agentStatus"], "pending");
}

#[test]
fn a_move_cancels_the_request_and_the_wait_says_so() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let waiter = ask_and_wait(home.path(), 30);
    wait_for_request(home.path());
    let moved = agboard(
        home.path(),
        &["mv", "1", "doing", "--actor", "human", "--reason", "Start."],
    );
    assert!(moved.status.success());
    let output = waiter.wait_with_output().unwrap();
    stop(server);
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "request_changed");
}

#[test]
fn without_a_server_nothing_is_asked() {
    let home = tempdir().unwrap();
    board(home.path());
    let output = ask_and_wait(home.path(), 5).wait_with_output().unwrap();
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert_eq!(card(home.path())["agentStatus"], "idle");
}

#[test]
fn a_wait_without_its_time_or_out_of_range_is_refused_and_nothing_is_asked() {
    let home = tempdir().unwrap();
    board(home.path());
    for wait in [
        r#"{}"#,
        r#"{"timeoutSeconds":0}"#,
        r#"{"timeoutSeconds":86401}"#,
        "true",
    ] {
        let output = agboard(
            home.path(),
            &[
                "--json",
                "state",
                "1",
                "pending",
                "--actor",
                "ai",
                "--request-json",
                &question(Some(wait)),
            ],
        );
        assert!(!output.status.success(), "{wait}");
        let error: Value = serde_json::from_slice(&output.stderr).unwrap();
        assert_eq!(error["error"]["code"], "invalid_value", "{wait}");
        assert_eq!(card(home.path())["agentStatus"], "idle", "{wait}");
    }
}

#[test]
fn without_a_wait_the_question_is_sent_and_the_command_returns() {
    let home = tempdir().unwrap();
    board(home.path());
    let output = agboard(
        home.path(),
        &[
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &question(None),
        ],
    );
    assert!(output.status.success());
    assert_eq!(card(home.path())["agentStatus"], "pending");
}
