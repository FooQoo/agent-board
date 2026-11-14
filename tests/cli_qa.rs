//! `agboard qa`: asking, waiting, answering, and reading project questions.

mod common;

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};

use serde_json::Value;
use tempfile::tempdir;

use common::{Running, agboard, decision_json, demo_project, json_error, json_ok};

fn demo(args: &[&str]) -> Vec<String> {
    let mut all = vec!["--project".to_string(), "Demo".to_string()];
    all.extend(args.iter().map(|a| a.to_string()));
    all
}

fn run(home: &Path, args: &[&str]) -> (i32, String, String) {
    let all = demo(args);
    let refs: Vec<&str> = all.iter().map(String::as_str).collect();
    agboard(home, &refs)
}

fn lines(out: &str) -> Vec<Value> {
    out.lines()
        .map(|l| serde_json::from_str(l).unwrap_or_else(|_| panic!("not JSON: {l}")))
        .collect()
}

/// A waiting `qa ask` or `qa wait`, read line by line.
struct Waiter {
    child: Child,
    out: BufReader<std::process::ChildStdout>,
}

impl Waiter {
    fn spawn(home: &Path, args: &[&str]) -> Waiter {
        let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", home)
            .env("TZ", "UTC")
            .current_dir(home)
            .args(demo(args))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        Waiter { child, out }
    }

    fn next(&mut self) -> Value {
        let mut line = String::new();
        self.out.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("not JSON: {line:?}"))
    }

    fn finish(mut self) -> (Value, i32) {
        let last = self.next();
        let code = self.child.wait().unwrap().code().unwrap();
        (last, code)
    }
}

impl Drop for Waiter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn ask_without_waiting_needs_no_server_and_a_wait_needs_one() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let request = decision_json("Which plan?");

    let (code, err) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--request-json",
            &request,
        ],
    );
    assert_eq!((code, err.as_str()), (1, "board_unavailable"));
    let listed = json_ok(home.path(), &["--project", "Demo", "qa", "ls", "--json"]);
    assert_eq!(listed["questions"], serde_json::json!([]));

    let (code, out, err) = run(
        home.path(),
        &[
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--request-json",
            &request,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let events = lines(&out);
    assert_eq!(events.len(), 1, "{out}");
    assert_eq!(events[0]["type"], "registered");
    assert_eq!(events[0]["questions"][0]["id"], "Q-1");
    assert_eq!(events[0]["resumed"], false);

    let task = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    let task = if task["task"].is_object() {
        &task["task"]
    } else {
        &task
    };
    assert_eq!(task["agentStatus"], "pending", "{task}");
    assert_eq!(task["openQuestionIds"], serde_json::json!(["Q-1"]));
}

#[test]
fn a_wait_ends_with_an_answer_a_timeout_or_a_withdrawal() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let request = decision_json("Which plan?");

    // Timeout: exit 5, the question stays open.
    let mut waiter = Waiter::spawn(
        home.path(),
        &[
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--request-json",
            &request,
            "--timeout",
            "1",
            "--json",
        ],
    );
    let registered = waiter.next();
    assert_eq!(registered["type"], "registered");
    let request_id = registered["requestId"].as_str().unwrap().to_string();
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("timeout"), 5),
        "{last}"
    );
    assert_eq!(last["answered"], 0);

    // Waiting again, then an answer from the CLI: exit 0.
    let mut waiter = Waiter::spawn(home.path(), &["qa", "wait", &request_id, "--json"]);
    let resumed = waiter.next();
    assert_eq!(resumed["type"], "registered");
    assert_eq!(resumed["resumed"], true);
    let (code, _, err) = run(
        home.path(),
        &[
            "qa", "answer", "Q-1", "--actor", "human", "--via", "cli", "--choice", "b",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("answered"), 0),
        "{last}"
    );
    assert_eq!(last["answers"][0]["id"], "Q-1");
    assert_eq!(last["answers"][0]["choiceId"], "b");
    assert_eq!(last["answers"][0]["via"], "cli");

    // Answering again fails and prints the recorded answer.
    let (code, _, err) = run(
        home.path(),
        &[
            "qa", "answer", "Q-1", "--actor", "human", "--via", "chat", "--choice", "a", "--json",
        ],
    );
    assert_eq!(code, 1);
    let error: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(error["error"]["code"], "question_answered");
    assert_eq!(error["questions"][0]["answer"]["choiceId"], "b", "{error}");

    // Withdrawal: exit 6.
    let mut waiter = Waiter::spawn(
        home.path(),
        &[
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--request-json",
            &request,
            "--json",
        ],
    );
    let registered = waiter.next();
    let second = registered["requestId"].as_str().unwrap().to_string();
    assert_eq!(registered["questions"][0]["id"], "Q-2");
    let (code, _, err) = run(
        home.path(),
        &[
            "qa",
            "withdraw",
            &second,
            "--actor",
            "ai",
            "--reason",
            "No longer needed.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("withdrawn"), 6),
        "{last}"
    );
    assert_eq!(last["reason"], "No longer needed.");

    // Withdrawing an answered request is refused.
    let (code, err) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "qa",
            "withdraw",
            &request_id,
            "--actor",
            "ai",
        ],
    );
    assert_eq!((code, err.as_str()), (1, "request_answered"));
    server.stop();
}

#[test]
fn questions_are_listed_shown_and_linked_to_tasks() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = run(
        home.path(),
        &[
            "add",
            "Write the guide",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let request = decision_json("Which plan?");
    let (code, out, err) = run(
        home.path(),
        &[
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--request-json",
            &request,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let request_id = lines(&out)[0]["requestId"].as_str().unwrap().to_string();

    let listed = json_ok(home.path(), &["--project", "Demo", "qa", "ls", "--json"]);
    assert_eq!(listed["questions"][0]["id"], "Q-1");
    assert_eq!(listed["questions"][0]["status"], "open");

    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "qa", "show", "Q-1", "--json"],
    );
    assert_eq!(shown["question"]["requestId"], request_id.as_str());
    let shown = json_ok(
        home.path(),
        &["--project", "Demo", "qa", "show", &request_id, "--json"],
    );
    assert_eq!(shown["request"]["status"], "open");
    assert_eq!(shown["questions"][0]["id"], "Q-1");

    let linked = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "qa",
            "link",
            "Q-1",
            "--task",
            "2",
            "--json",
        ],
    );
    assert_eq!(linked["task"]["questionIds"], serde_json::json!(["Q-1"]));
    assert_eq!(linked["task"]["agentStatus"], "pending");
    let unlinked = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "qa",
            "unlink",
            "Q-1",
            "--task",
            "2",
            "--json",
        ],
    );
    assert_eq!(unlinked["task"]["questionIds"], serde_json::json!([]));
    assert_eq!(unlinked["task"]["agentStatus"], "idle");

    let (code, err) = json_error(home.path(), &["--project", "Demo", "qa", "show", "Q-9"]);
    assert_eq!((code, err.as_str()), (3, "question_not_found"));
    let (code, err) = json_error(
        home.path(),
        &["--project", "Demo", "qa", "link", "Q-9", "--task", "2"],
    );
    assert_eq!((code, err.as_str()), (3, "question_not_found"));
}
