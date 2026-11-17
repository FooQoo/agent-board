//! `agboard message ask` and `message wait`: the events of a wait and how it ends, and that
//! asking without waiting needs no server.

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

/// A waiting `message ask` or `message wait`, read line by line.
struct Waiter {
    child: Child,
    out: BufReader<std::process::ChildStdout>,
}

impl Waiter {
    fn spawn(home: &Path, args: &[&str]) -> Waiter {
        let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_AUTOSTART", "0")
            .env("AGBOARD_OPEN_BROWSER", "0")
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
fn ask_without_waiting_needs_no_server_and_a_wait_without_autostart_needs_one() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let request = decision_json("Which plan?");

    let (code, err) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            &request,
        ],
    );
    assert_eq!((code, err.as_str()), (1, "board_unavailable"));
    let listed = json_ok(
        home.path(),
        &["--project", "Demo", "message", "ls", "--json"],
    );
    assert_eq!(listed["messages"], serde_json::json!([]));

    let (code, out, err) = run(
        home.path(),
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
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
    let task = &task["task"];
    assert_eq!(task["agentStatus"], "pending", "{task}");
    assert_eq!(task["openQuestionIds"], serde_json::json!(["Q-1"]));
    // The board answers the question named here.
    assert_eq!(task["pendingRequestId"], "Q-1");
    assert_eq!(task["pendingReason"], "Which plan?");
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
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            &request,
            "--timeout",
            "1",
            "--json",
        ],
    );
    let registered = waiter.next();
    assert_eq!(registered["type"], "registered");
    assert_eq!(registered["questions"][0]["id"], "Q-1");
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("timeout"), 5),
        "{last}"
    );
    assert_eq!(last["answered"], 0);

    // Waiting again, then an answer from the CLI: exit 0.
    let mut waiter = Waiter::spawn(home.path(), &["message", "wait", "Q-1", "--json"]);
    let resumed = waiter.next();
    assert_eq!(resumed["type"], "registered");
    assert_eq!(resumed["resumed"], true);
    let (code, _, err) = run(
        home.path(),
        &[
            "message", "answer", "Q-1", "--actor", "human", "--via", "cli", "--choice", "b",
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
            "message", "answer", "Q-1", "--actor", "human", "--via", "chat", "--choice", "a",
            "--json",
        ],
    );
    assert_eq!(code, 1);
    let error: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(error["error"]["code"], "question_answered");
    assert_eq!(error["questions"][0]["reply"]["choiceId"], "b", "{error}");

    // Withdrawal: exit 6.
    let mut waiter = Waiter::spawn(
        home.path(),
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            &request,
            "--json",
        ],
    );
    let registered = waiter.next();
    assert_eq!(registered["questions"][0]["id"], "Q-2");
    let (code, _, err) = run(
        home.path(),
        &["message", "withdraw", "Q-2", "--actor", "ai"],
    );
    assert_eq!(code, 0, "{err}");
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("withdrawn"), 6),
        "{last}"
    );
    assert_eq!(last["ids"], serde_json::json!(["Q-2"]));

    // Withdrawing an answered question is refused.
    let (code, err) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "withdraw",
            "Q-1",
            "--actor",
            "ai",
        ],
    );
    assert_eq!((code, err.as_str()), (1, "message_closed"));
    server.stop();
}

#[test]
fn one_wait_follows_several_questions_to_the_last_answer() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let server = Running::start(home.path());
    let both = r#"{"questions":[{"body":"First?","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}]},{"body":"Second?"}]}"#;
    let mut waiter = Waiter::spawn(
        home.path(),
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            both,
            "--json",
        ],
    );
    let registered = waiter.next();
    assert_eq!(
        registered["questions"],
        serde_json::json!([{"id": "Q-1"}, {"id": "Q-2"}])
    );
    let (code, _, err) = run(
        home.path(),
        &[
            "message", "answer", "Q-2", "--actor", "human", "--via", "cli", "--text", "Later.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    // One answer is not the end: the wait goes on until the other is answered too.
    let (code, _, err) = run(
        home.path(),
        &[
            "message", "answer", "Q-1", "--actor", "human", "--via", "cli", "--choice", "a",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (last, code) = waiter.finish();
    assert_eq!(
        (last["type"].as_str(), code),
        (Some("answered"), 0),
        "{last}"
    );
    assert_eq!(last["ids"], serde_json::json!(["Q-1", "Q-2"]));
    assert_eq!(last["answers"][1]["text"], "Later.");
    server.stop();
}

#[test]
fn edit_with_desc_file_keeps_question_refs_and_the_task_stays_pending() {
    let home = tempdir().unwrap();
    demo_project(home.path());
    let request = decision_json("Which plan?");
    let (code, _, err) = run(
        home.path(),
        &[
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            &request,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let before = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(before["task"]["questionIds"], serde_json::json!(["Q-1"]));
    assert_eq!(before["task"]["agentStatus"], "pending");

    // A desc file that names other questions neither adds nor removes any ref.
    let file = home.path().join("desc.md");
    std::fs::write(&file, "---\nquestions: [Q-9]\n---\nReplaced body\n").unwrap();
    let path = file.to_str().unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--desc-file", path],
    );
    assert_eq!(code, 0, "{err}");
    let after = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(after["task"]["body"], "Replaced body");
    assert_eq!(after["task"]["questionIds"], serde_json::json!(["Q-1"]));
    assert_eq!(after["task"]["agentStatus"], "pending");

    // The same holds for a plain file without frontmatter.
    std::fs::write(&file, "Second body\n").unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--desc-file", path],
    );
    assert_eq!(code, 0, "{err}");
    let after = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(after["task"]["questionIds"], serde_json::json!(["Q-1"]));
    assert_eq!(after["task"]["agentStatus"], "pending");
}
