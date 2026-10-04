use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use serde_json::Value;
use tempfile::tempdir;

fn agboard(home: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn wait_returns_the_latest_full_snapshot_for_a_change_around_subscription() {
    let home = tempdir().unwrap();
    assert!(
        agboard(home.path(), &["init", "--name", "Agent Board"])
            .status
            .success()
    );
    assert!(
        agboard(
            home.path(),
            &[
                "add",
                "Answer the user",
                "--assignee",
                "ai",
                "--actor",
                "ai"
            ]
        )
        .status
        .success()
    );
    assert!(
        agboard(
            home.path(),
            &[
                "mv",
                "1",
                "doing",
                "--actor",
                "ai",
                "--reason",
                "Start work"
            ]
        )
        .status
        .success()
    );
    let pending = agboard(
        home.path(),
        &[
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--reason",
            "Need the user's direction",
            "--json",
        ],
    );
    assert!(pending.status.success());
    let pending: Value = serde_json::from_slice(&pending.stdout).unwrap();
    let request_id = pending["card"]["pendingRequestId"].as_str().unwrap();
    let baseline = agboard(home.path(), &["snapshot", "--json"]);
    assert!(baseline.status.success());
    let baseline: Value = serde_json::from_slice(&baseline.stdout).unwrap();
    let after = baseline["revision"].as_i64().unwrap().to_string();
    let mut server = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
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

    let waiter = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
        .args(["--json", "wait", "--after", &after, "--timeout", "5"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let answer = agboard(
        home.path(),
        &[
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            request_id,
            "--reason",
            "Keep the current behavior and explain the tradeoff.",
        ],
    );
    assert!(
        answer.status.success(),
        "{}",
        String::from_utf8_lossy(&answer.stderr)
    );
    let output = waiter.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let snapshot: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(snapshot["revision"].as_i64().unwrap() > baseline["revision"].as_i64().unwrap());
    assert_eq!(snapshot["cards"][0]["title"], "Answer the user");
    assert_eq!(snapshot["cards"][0]["agentStatus"], "idle");
    assert_eq!(snapshot["cards"][0]["history"].as_array().unwrap().len(), 4);
    assert_eq!(
        snapshot["cards"][0]["history"][3]["reason"],
        "Keep the current behavior and explain the tradeoff."
    );
    let resume = agboard(
        home.path(),
        &[
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "Resume using the user's direction.",
        ],
    );
    assert!(resume.status.success());
    let latest = agboard(home.path(), &["snapshot", "--json"]);
    let latest: Value = serde_json::from_slice(&latest.stdout).unwrap();
    assert_eq!(latest["cards"][0]["agentStatus"], "running");
    assert_eq!(latest["cards"][0]["history"].as_array().unwrap().len(), 5);
    server.kill().unwrap();
    let _ = server.wait();
}

#[test]
fn wait_timeout_and_unavailable_are_not_reported_as_board_changes() {
    let home = tempdir().unwrap();
    let missing = agboard(
        home.path(),
        &["--json", "wait", "--after", "0", "--timeout", "0"],
    );
    assert!(!missing.status.success());
    let error: Value = serde_json::from_slice(&missing.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert!(!home.path().join("board.db").exists());
}
