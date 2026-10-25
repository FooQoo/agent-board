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

/// A board with one AI task in todo.
fn board(home: &Path) {
    assert!(agboard(home, &["init"]).status.success());
    assert!(
        agboard(home, &["add", "Ask", "--assignee", "ai", "--actor", "ai"])
            .status
            .success()
    );
}

fn task(home: &Path) -> Value {
    let shown = agboard(home, &["show", "1", "--json"]);
    serde_json::from_slice::<Value>(&shown.stdout).unwrap()["task"].clone()
}

/// The pending request ID once the task has asked.
fn wait_for_request(home: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(id) = task(home)["pendingRequestId"].as_str() {
            return id.to_string();
        }
        assert!(Instant::now() < deadline, "the task never became pending");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Spawns a wait with the default SIGINT disposition a terminal user has. A child of a
/// background run (a non-interactive shell's `&`, nohup) inherits an ignored SIGINT, and then the
/// interrupt test would never end; the same fix as the wait tests in `agent_projects.rs`.
fn spawn_wait(mut command: Command) -> Child {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: the hook only calls the async-signal-safe `signal`.
        unsafe {
            command.pre_exec(|| {
                libc::signal(libc::SIGINT, libc::SIG_DFL);
                Ok(())
            });
        }
    }
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn ask_and_wait(home: &Path, timeout_seconds: u64) -> Child {
    let wait = format!(r#"{{"timeoutSeconds":{timeout_seconds}}}"#);
    spawn_wait(command(
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
    ))
}

/// Asks with the given `wait` value (`None` omits the key) and no `--no-wait`.
fn ask_with(home: &Path, wait: Option<&str>) -> Child {
    spawn_wait(command(
        home,
        &[
            "--json",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &question(wait),
        ],
    ))
}

/// The default wait: the JSON leaves `wait` out.
fn ask_and_wait_forever(home: &Path) -> Child {
    ask_with(home, None)
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
    assert_eq!(reply["task"]["agentStatus"], "idle");
    assert_eq!(reply["task"]["taskStatus"], "todo");
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
    assert_eq!(task(home.path())["agentStatus"], "pending");
}

#[test]
fn wait_without_a_timeout_returns_the_answer_and_leaves_no_expiry() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let waiter = ask_and_wait_forever(home.path());
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
    assert_eq!(reply["task"]["agentStatus"], "idle");
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
    // An explicit task move withdraws the question; ending the waiter does not
    // restore or otherwise rewrite the task's new state.
    assert_eq!(task(home.path())["agentStatus"], "idle");
}

#[test]
fn an_indefinite_wait_reports_connection_loss_without_expiring_the_question() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let waiter = ask_and_wait_forever(home.path());
    wait_for_request(home.path());

    stop(server);
    let output = waiter.wait_with_output().unwrap();
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert_eq!(task(home.path())["agentStatus"], "pending");
    assert!(task(home.path())["pendingRequestId"].is_string());
}

#[cfg(unix)]
#[test]
fn interrupting_the_indefinite_wait_preserves_the_pending_question() {
    let home = tempdir().unwrap();
    board(home.path());
    let server = start_server(home.path());
    let waiter = ask_and_wait_forever(home.path());
    wait_for_request(home.path());
    assert_eq!(task(home.path())["agentStatus"], "pending");

    let status = Command::new("kill")
        .args(["-INT", &waiter.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let output = waiter.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert_eq!(task(home.path())["agentStatus"], "pending");
    assert!(task(home.path())["pendingRequestId"].is_string());
    stop(server);
}

#[test]
fn without_a_server_nothing_is_asked() {
    let home = tempdir().unwrap();
    board(home.path());
    let output = ask_and_wait(home.path(), 5).wait_with_output().unwrap();
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert_eq!(task(home.path())["agentStatus"], "idle");
}

#[test]
fn a_wait_without_its_time_or_out_of_range_is_refused_and_nothing_is_asked() {
    let home = tempdir().unwrap();
    board(home.path());
    for wait in [
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
        assert_eq!(task(home.path())["agentStatus"], "idle", "{wait}");
    }
}

/// `state 1 pending` with the question and the extra arguments, run to completion.
fn ask_now(home: &Path, wait: Option<&str>, extra: &[&str]) -> Output {
    let question = question(wait);
    let mut args = vec![
        "--json",
        "state",
        "1",
        "pending",
        "--actor",
        "ai",
        "--request-json",
        &question,
    ];
    args.extend_from_slice(extra);
    agboard(home, &args)
}

fn error_code(output: &Output) -> String {
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    error["error"]["code"].as_str().unwrap().to_string()
}

fn show(home: &Path) -> Value {
    let shown = agboard(home, &["show", "1", "--json"]);
    serde_json::from_slice(&shown.stdout).unwrap()
}

#[test]
fn every_form_without_a_time_waits_for_the_answer() {
    for wait in [
        None,
        Some("{}"),
        Some("null"),
        Some(r#"{"timeoutSeconds":null}"#),
    ] {
        let home = tempdir().unwrap();
        board(home.path());
        let server = start_server(home.path());
        let mut waiter = ask_with(home.path(), wait);
        let request = wait_for_request(home.path());
        // The question is saved, yet the command is still waiting for its answer.
        std::thread::sleep(Duration::from_millis(500));
        assert!(waiter.try_wait().unwrap().is_none(), "{wait:?}");
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
                "b",
                "--reason",
                "B it is.",
            ],
        );
        assert!(answered.status.success());
        let output = waiter.wait_with_output().unwrap();
        stop(server);
        assert!(output.status.success(), "{wait:?}");
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(reply["answer"]["choiceId"], "b", "{wait:?}");
        assert_eq!(reply["answer"]["text"], "B it is.", "{wait:?}");
        assert_eq!(reply["task"]["agentStatus"], "idle", "{wait:?}");
    }
}

#[test]
fn no_wait_registers_the_question_and_returns_without_a_server() {
    for wait in [None, Some("{}"), Some(r#"{"timeoutSeconds":null}"#)] {
        let home = tempdir().unwrap();
        board(home.path());
        let output = ask_now(home.path(), wait, &["--no-wait"]);
        assert!(output.status.success(), "{wait:?}");
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(reply["task"]["agentStatus"], "pending", "{wait:?}");
        assert!(reply.get("answer").is_none(), "{wait:?}");
        assert!(task(home.path())["pendingRequestId"].is_string());
        // The wait choice is a process setting; it is never stored.
        let stored = std::fs::read_to_string(
            std::fs::read_dir(home.path().join("shared/projects"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path()
                .join("tasks/1/task.json"),
        )
        .unwrap();
        assert!(!stored.contains("wait"), "{stored}");
    }
}

#[test]
fn no_wait_with_a_time_is_refused_and_nothing_changes() {
    let home = tempdir().unwrap();
    board(home.path());
    let before = show(home.path());
    for server in [false, true] {
        let running = server.then(|| start_server(home.path()));
        let output = ask_now(
            home.path(),
            Some(r#"{"timeoutSeconds":30}"#),
            &["--no-wait"],
        );
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(error_code(&output), "invalid_argument");
        assert_eq!(show(home.path()), before);
        if let Some(running) = running {
            stop(running);
        }
    }
}

#[test]
fn no_wait_applies_only_to_asking() {
    let home = tempdir().unwrap();
    board(home.path());
    let before = show(home.path());
    let output = agboard(
        home.path(),
        &[
            "--json",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--no-wait",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(error_code(&output), "invalid_argument");
    assert_eq!(show(home.path()), before);

    assert!(ask_now(home.path(), None, &["--no-wait"]).status.success());
    let request = task(home.path())["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string();
    let before = show(home.path());
    let output = agboard(
        home.path(),
        &[
            "--json",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "a",
            "--no-wait",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(error_code(&output), "invalid_argument");
    assert_eq!(show(home.path()), before);
}

#[test]
fn no_wait_does_not_hide_an_invalid_request() {
    let home = tempdir().unwrap();
    board(home.path());
    let before = show(home.path());
    let output = ask_now(home.path(), Some("true"), &["--no-wait"]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(error_code(&output), "invalid_value");
    assert_eq!(show(home.path()), before);
}

#[test]
fn a_waiting_ask_without_a_server_changes_nothing() {
    let home = tempdir().unwrap();
    board(home.path());
    let before = show(home.path());
    for wait in [None, Some("{}"), Some(r#"{"timeoutSeconds":600}"#)] {
        let output = ask_now(home.path(), wait, &[]);
        assert_eq!(output.status.code(), Some(1), "{wait:?}");
        assert_eq!(error_code(&output), "board_unavailable", "{wait:?}");
        assert_eq!(show(home.path()), before, "{wait:?}");
    }
}
