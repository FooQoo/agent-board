//! `agboard message ...`: asking, answering, withdrawing, sending and accepting, and the JSON
//! each command prints.

mod common;

use std::path::Path;

use common::{agboard, demo_project, json_error, json_ok};
use serde_json::{Value, json};

const TWO: &str = r#"{"questions":[
  {"body":"Keep the data?","choices":[{"id":"keep","label":"Keep"},{"id":"drop","label":"Drop"}],"recommendedChoiceId":"keep"},
  {"body":"Anything else to know?"}
]}"#;

/// A 1x1 PNG.
const PNG: [u8; 70] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0x60, 0xf8, 0x5f,
    0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0xeb, 0x47, 0xba, 0x92, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn msg(home: &Path, args: &[&str]) -> (i32, String, String) {
    let mut all = vec!["--project", "Demo", "message"];
    all.extend_from_slice(args);
    agboard(home, &all)
}

fn msg_json(home: &Path, args: &[&str]) -> Value {
    let mut all = vec!["--project", "Demo", "--json", "message"];
    all.extend_from_slice(args);
    json_ok(home, &all[..])
}

fn ask(home: &Path) {
    let (code, out, err) = msg(
        home,
        &[
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--questions-json",
            TWO,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let first: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert_eq!(first["type"], "registered");
    assert_eq!(first["questions"], json!([{"id": "Q-1"}, {"id": "Q-2"}]));
    assert_eq!(first["resumed"], false);
}

#[test]
fn one_ask_makes_one_message_for_each_question() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());

    let listed = msg_json(home.path(), &["ls"]);
    let ids: Vec<_> = listed["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["Q-1", "Q-2"]);
    assert_eq!(listed["messages"][0]["type"], "question");
    assert_eq!(listed["messages"][0]["recommendedChoiceId"], "keep");
    assert_eq!(listed["messages"][0]["referencedBy"], json!([1]));
    assert_eq!(listed["messages"][1]["choices"], json!([]));

    let shown = msg_json(home.path(), &["show", "Q-1"]);
    assert_eq!(shown["question"]["body"], "Keep the data?");
    assert_eq!(shown["question"]["status"], "open");
    assert_eq!(shown["question"]["reply"], Value::Null);
    let human = msg(home.path(), &["show", "Q-1"]).1;
    assert!(human.contains("Q-1 (question, open)") && human.contains("keep: Keep (recommended)"));

    let task = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(task["task"]["openQuestionIds"], json!(["Q-1", "Q-2"]));
    assert_eq!(task["task"]["agentStatus"], "pending");

    // The old command and its flags are gone.
    let (code, _, _) = agboard(home.path(), &["--project", "Demo", "qa", "ls"]);
    assert_ne!(code, 0);
    let (code, _, _) = msg(
        home.path(),
        &["ask", "--actor", "ai", "--request-json", TWO, "--no-wait"],
    );
    assert_ne!(code, 0);
    // A person cannot ask.
    let (code, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "ask",
            "--actor",
            "human",
            "--questions-json",
            TWO,
            "--no-wait",
        ],
    );
    assert_eq!((code, error.as_str()), (1, "ai_only"));
}

#[test]
fn an_answer_is_one_question_at_a_time_and_the_first_one_stands() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());

    let (code, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "answer",
            "Q-1",
            "--actor",
            "human",
            "--via",
            "cli",
            "--text",
            "words only",
        ],
    );
    assert_eq!((code, error.as_str()), (2, "invalid_value"));
    let answered = msg_json(
        home.path(),
        &[
            "answer", "Q-1", "--actor", "human", "--via", "chat", "--choice", "keep",
        ],
    );
    assert_eq!(answered["questions"][0]["reply"]["choiceLabel"], "Keep");
    assert_eq!(answered["questions"][0]["reply"]["via"], "chat");
    let text = msg_json(
        home.path(),
        &[
            "answer", "Q-2", "--actor", "human", "--via", "cli", "--text", "Nothing.",
        ],
    );
    assert_eq!(text["questions"][0]["status"], "answered");

    let (code, _, err) = msg(
        home.path(),
        &[
            "answer", "Q-1", "--actor", "human", "--via", "cli", "--choice", "drop", "--json",
        ],
    );
    assert_eq!(code, 1);
    let refused: Value = serde_json::from_str(&err).unwrap();
    assert_eq!(refused["error"]["code"], "question_answered");
    assert_eq!(refused["questions"][0]["reply"]["choiceId"], "keep");

    let task = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
    assert_eq!(task["task"]["openQuestionIds"], json!([]));
    // Both are closed, so a wait ends at once with the answers, without a server.
    let (code, out, _) = msg(home.path(), &["wait", "Q-1", "Q-2", "--json"]);
    assert_eq!(code, 0);
    let last: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
    assert_eq!(last["type"], "answered");
    assert_eq!(last["ids"], json!(["Q-1", "Q-2"]));
    assert_eq!(last["answers"][0]["choiceId"], "keep");
    assert_eq!(last["answers"][1]["text"], "Nothing.");
}

#[test]
fn a_withdrawn_question_ends_a_wait_with_exit_6() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    ask(home.path());
    msg_json(
        home.path(),
        &[
            "answer", "Q-1", "--actor", "human", "--via", "cli", "--choice", "keep",
        ],
    );
    let withdrawn = msg_json(home.path(), &["withdraw", "Q-2", "--actor", "ai"]);
    assert_eq!(withdrawn["question"]["status"], "withdrawn");
    let (code, out, _) = msg(home.path(), &["wait", "Q-1", "Q-2", "--json"]);
    assert_eq!(code, 6);
    let last: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
    assert_eq!(last["type"], "withdrawn");
    assert_eq!(last["ids"], json!(["Q-2"]));
    assert_eq!(last["answers"][0]["id"], "Q-1");

    let (_, error) = json_error(
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
    assert_eq!(error, "message_closed");
    let (_, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "withdraw",
            "Q-2",
            "--actor",
            "human",
        ],
    );
    assert_eq!(error, "ai_only");
    let (code, error) = json_error(
        home.path(),
        &["--project", "Demo", "message", "show", "Q-9"],
    );
    assert_eq!((code, error.as_str()), (3, "message_not_found"));
}

#[test]
fn a_person_sends_a_request_and_one_agent_accepts_it() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let image = home.path().join("login.png");
    std::fs::write(&image, PNG).unwrap();
    let body = home.path().join("request.md");
    std::fs::write(&body, "Add a reset link.\n\n![](attachments/login.png)\n").unwrap();

    let sent = msg_json(
        home.path(),
        &[
            "send",
            "--actor",
            "human",
            "--text-file",
            body.to_str().unwrap(),
            "--image",
            image.to_str().unwrap(),
        ],
    );
    assert_eq!(sent["request"]["id"], "Q-1");
    assert_eq!(sent["request"]["type"], "request");
    assert_eq!(sent["request"]["status"], "open");
    assert_eq!(sent["request"]["from"], "human");
    let shared = home.path().join("shared/projects");
    let project = std::fs::read_dir(&shared)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(project.join("qa/Q-1/attachments/login.png").is_file());
    assert!(
        std::fs::read_to_string(project.join("qa/Q-1/QA.md"))
            .unwrap()
            .contains("from: human")
    );

    let listed = msg_json(home.path(), &["ls", "--type", "request"]);
    assert_eq!(listed["messages"][0]["id"], "Q-1");
    let (_, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "accept",
            "Q-1",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(error, "invalid_argument");

    let accepted = msg_json(
        home.path(),
        &["accept", "Q-1", "--actor", "ai", "--by", "session-1"],
    );
    assert_eq!(accepted["request"]["status"], "accepted");
    assert_eq!(accepted["request"]["acceptedBy"], "session-1");
    let (code, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "accept",
            "Q-1",
            "--actor",
            "ai",
            "--by",
            "session-2",
        ],
    );
    assert_eq!((code, error.as_str()), (1, "request_accepted"));
    assert_eq!(msg_json(home.path(), &["ls"])["messages"], json!([]));
    let closed = msg_json(home.path(), &["ls", "--status", "closed"]);
    assert_eq!(closed["messages"][0]["acceptedBy"], "session-1");

    // A request is withdrawn by a person, until an agent takes it.
    let second = msg_json(
        home.path(),
        &["send", "--actor", "human", "--text", "Never mind."],
    );
    assert_eq!(second["request"]["id"], "Q-2");
    let (_, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "withdraw",
            "Q-2",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(error, "human_only");
    let gone = msg_json(home.path(), &["withdraw", "Q-2", "--actor", "human"]);
    assert_eq!(gone["request"]["status"], "withdrawn");
    let (_, error) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "accept",
            "Q-2",
            "--actor",
            "ai",
            "--by",
            "session-1",
        ],
    );
    assert_eq!(error, "request_withdrawn");
}

#[test]
fn link_and_unlink_change_what_a_task_waits_for() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = msg(
        home.path(),
        &["ask", "--actor", "ai", "--questions-json", TWO, "--no-wait"],
    );
    assert_eq!(code, 0, "{err}");
    let task =
        |home: &Path| json_ok(home, &["--project", "Demo", "show", "1", "--json"])["task"].clone();
    assert_eq!(task(home.path())["agentStatus"], "idle");

    let linked = msg_json(home.path(), &["link", "Q-1", "--task", "1"]);
    assert_eq!(linked["task"]["questionIds"], json!(["Q-1"]));
    assert_eq!(task(home.path())["agentStatus"], "pending");
    let unlinked = msg_json(home.path(), &["unlink", "Q-1", "--task", "1"]);
    assert_eq!(unlinked["task"]["questionIds"], json!([]));
    assert_eq!(task(home.path())["agentStatus"], "idle");

    msg_json(
        home.path(),
        &["send", "--actor", "human", "--text", "A request"],
    );
    let (_, error) = json_error(
        home.path(),
        &["--project", "Demo", "message", "link", "Q-3", "--task", "1"],
    );
    assert_eq!(error, "message_type_mismatch");
}
