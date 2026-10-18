//! End-to-end CLI checks for the task-listening wait contract.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tempfile::TempDir;

fn run(home: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .output()
        .expect("agboard should start")
}

fn success(home: &Path, args: &[&str]) -> Output {
    let output = run(home, args);
    assert!(
        output.status.success(),
        "command failed: {args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).expect("stdout must contain one JSON document")
}

fn fixture() -> TempDir {
    let home = tempfile::tempdir().expect("temporary AGBOARD_HOME");
    let folder = home.path().join("project-folder");
    fs::create_dir_all(&folder).unwrap();
    success(
        home.path(),
        &[
            "project",
            "create",
            "Listen",
            "--folder",
            folder.to_str().unwrap(),
        ],
    );
    home
}

fn serve(home: &Path, port: u16) -> Child {
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args(["serve", "--port", &port.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("serve should start");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .expect("read serve readiness");
    assert!(line.contains(&format!("127.0.0.1:{port}")), "{line}");
    child
}

fn wait(home: &Path, timeout: &str) -> Child {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .args([
            "--project",
            "Listen",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            timeout,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("wait should start")
}

fn stop(mut server: Child) {
    server.kill().expect("stop fixture server");
    let status = server.wait().expect("reap fixture server");
    assert!(!status.success());
}

#[test]
fn wait_cli_returns_a_task_created_in_the_same_session_without_claiming_it() {
    let home = fixture();
    let server = serve(home.path(), 8730);
    let waiter = wait(home.path(), "10");
    thread::sleep(Duration::from_millis(250));

    let created = success(
        home.path(),
        &[
            "--project",
            "Listen",
            "add",
            "Arrived while listening",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--json",
        ],
    );
    let created_id = json(&created)["task"]["id"].as_i64().unwrap();
    let output = waiter.wait_with_output().expect("wait should complete");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let selected = json(&output);
    assert_eq!(selected["kind"], "task");
    assert_eq!(selected["task"]["id"], created_id);
    assert_eq!(selected["task"]["title"], "Arrived while listening");
    assert_eq!(selected["task"]["taskStatus"], "todo");
    assert_eq!(selected["task"]["agentStatus"], "idle");
    assert!(selected["taskPath"].as_str().unwrap().ends_with("/TASK.md"));
    assert!(selected["planPath"].is_null());

    let after = run(
        home.path(),
        &[
            "--project",
            "Listen",
            "show",
            &created_id.to_string(),
            "--json",
        ],
    );
    assert_eq!(after.status.code(), Some(0));
    let persisted = json(&after)["task"].clone();
    assert_eq!(persisted["taskStatus"], "todo");
    assert_eq!(persisted["agentStatus"], "idle");
    stop(server);
}

#[test]
fn irrelevant_same_project_events_do_not_restart_the_idle_timeout() {
    let home = fixture();
    let server = serve(home.path(), 8731);
    success(
        home.path(),
        &[
            "--project",
            "Listen",
            "add",
            "Human-owned pre-existing work",
            "--assignee",
            "human",
            "--actor",
            "human",
        ],
    );
    let waiter = wait(home.path(), "2");
    let began = Instant::now();
    thread::sleep(Duration::from_millis(350));
    success(
        home.path(),
        &[
            "--project",
            "Listen",
            "add",
            "Human-owned notification one",
            "--assignee",
            "human",
            "--actor",
            "human",
        ],
    );
    thread::sleep(Duration::from_millis(650));
    success(
        home.path(),
        &[
            "--project",
            "Listen",
            "add",
            "Human-owned notification two",
            "--assignee",
            "human",
            "--actor",
            "human",
        ],
    );
    let output = waiter
        .wait_with_output()
        .expect("idle wait should complete");
    let elapsed = began.elapsed();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(json(&output)["kind"], "idle_timeout");
    assert_eq!(json(&output)["idleTimeoutSeconds"], 2);
    assert!(
        elapsed >= Duration::from_millis(1800),
        "ended early: {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_millis(3000),
        "deadline restarted: {elapsed:?}"
    );
    stop(server);
}
