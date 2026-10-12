//! The CLI for decision requests (AC-5's CLI side, U6-2, U6-3, U6-6): a
//! pending state with `--request-file`, and an answer with `--request`,
//! `--choice`, and `--reason`, in each of the three combinations.

mod common;

use std::path::{Path, PathBuf};

use common::{agboard, demo_project, json_error, json_ok};
use serde_json::{Value, json};

/// Write `value` to a JSON file in `dir` and return its path.
fn request_file(dir: &Path, name: &str, value: &Value) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, value.to_string()).unwrap();
    path
}

fn three_choices() -> Value {
    json!({
        "question": "Which plan should we use?",
        "choices": [
            {"id": "proceed", "label": "Proceed as planned"},
            {"id": "revise", "label": "Revise the plan"},
            {"id": "wait", "label": "Wait for review"}
        ]
    })
}

/// Put card #1 into a pending request from `value` and return the request ID.
fn ask(home: &Path, value: &Value) -> String {
    let file = request_file(home, "request.json", value);
    json_ok(
        home,
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &std::fs::read_to_string(file).unwrap(),
            "--json",
        ],
    );
    let shown = json_ok(home, &["--project", "Demo", "show", "1", "--json"]);
    shown["card"]["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string()
}

fn card(home: &Path) -> Value {
    json_ok(home, &["--project", "Demo", "show", "1", "--json"])["card"].clone()
}

#[test]
fn a_request_file_keeps_the_question_and_its_choices() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request = ask(home.path(), &three_choices());

    let shown = card(home.path());
    assert_eq!(shown["agentStatus"], "pending");
    assert_eq!(shown["pendingReason"], "Which plan should we use?");
    assert_eq!(shown["pendingChoices"].as_array().unwrap().len(), 3);
    assert_eq!(shown["pendingChoices"][1]["id"], "revise");
    assert_eq!(shown["pendingRequestId"], request.as_str());
}

#[test]
fn answering_with_a_choice_only_returns_the_card_to_idle_and_keeps_the_choice_in_history() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request = ask(home.path(), &three_choices());

    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "revise",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let shown = card(home.path());
    assert_eq!(shown["agentStatus"], "idle");
    assert_eq!(shown["pendingRequestId"], Value::Null);
    let answer = shown["history"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(answer["kind"], "answer");
    assert_eq!(answer["requestId"], request.as_str());
    assert_eq!(answer["choiceId"], "revise");
    assert_eq!(answer["choiceLabel"], "Revise the plan");
    assert_eq!(answer["reason"], Value::Null);
}

#[test]
fn answering_with_a_note_only_is_accepted() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    // A reason-only request, the form that existed before choices.
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &common::decision_json("Which database?"),
        ],
    );
    assert_eq!(code, 0, "{err}");
    let request = card(home.path())["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string();

    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--reason",
            "Use plain files.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let shown = card(home.path());
    assert_eq!(shown["agentStatus"], "idle");
    let answer = shown["history"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(answer["reason"], "Use plain files.");
    assert_eq!(answer["choiceId"], Value::Null);
}

#[test]
fn answering_with_a_choice_and_a_note_keeps_both() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request = ask(home.path(), &three_choices());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "proceed",
            "--reason",
            "Keep the schedule.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let answer = card(home.path())["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(answer["choiceId"], "proceed");
    assert_eq!(answer["reason"], "Keep the schedule.");
}

#[test]
fn answering_with_neither_a_choice_nor_a_note_is_refused_and_the_request_stays() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request = ask(home.path(), &three_choices());
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
        ],
    );
    assert_ne!(code, 0);
    let shown = card(home.path());
    assert_eq!(shown["agentStatus"], "pending");
    assert_eq!(shown["pendingRequestId"], request.as_str());
}

#[test]
fn an_unknown_choice_is_refused_with_request_choice_unknown_and_nothing_changes() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let request = ask(home.path(), &three_choices());
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "nope",
        ],
    );
    assert_eq!((code, code_name.as_str()), (2, "request_choice_unknown"));
    assert_eq!(card(home.path())["pendingRequestId"], request.as_str());
}

#[test]
fn an_answer_to_a_request_that_has_changed_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let _old = ask(home.path(), &three_choices());
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            "00000000000000000000000000000000",
            "--choice",
            "proceed",
        ],
    );
    assert_eq!((code, code_name.as_str()), (1, "request_changed"));
}

#[test]
fn the_request_flags_are_checked_against_the_state_they_belong_to() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let file = request_file(home.path(), "request.json", &three_choices());
    let file_path = file.to_str().unwrap();

    // --request-file is for pending only, and takes no --reason with it.
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "x",
            "--request-file",
            file_path,
        ],
    );
    assert_eq!(code, 2);
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--reason",
            "x",
            "--request-file",
            file_path,
        ],
    );
    assert_eq!(code, 2);
    // --choice needs an answer to a pending request, and --request.
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "x",
            "--choice",
            "proceed",
        ],
    );
    assert_eq!(code, 2);
    ask(home.path(), &three_choices());
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--choice",
            "proceed",
        ],
    );
    assert_eq!(code, 2);
    // A running or pending state must still say what it is for.
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 2);
}

#[test]
fn a_request_file_is_checked_against_the_limits() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let refused = |value: Value| {
        let file = request_file(home.path(), "bad.json", &value);
        let (code, code_name) = json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "state",
                "1",
                "pending",
                "--actor",
                "ai",
                "--request-json",
                &std::fs::read_to_string(file).unwrap(),
            ],
        );
        assert_eq!((code, code_name.as_str()), (2, "invalid_value"), "{value}");
        assert_eq!(card(home.path())["agentStatus"], "idle", "nothing changed");
    };
    let choices = |n: usize, label_len: usize| -> Value {
        (0..n)
            .map(|i| json!({"id": format!("c{i}"), "label": "x".repeat(label_len)}))
            .collect::<Vec<_>>()
            .into()
    };

    refused(json!({"question": "q", "choices": choices(11, 1)}));
    refused(json!({"question": "q", "choices": choices(1, 201)}));
    refused(json!({"question": "   ", "choices": []}));
    refused(json!({"question": "x".repeat(2001)}));
    refused(
        json!({"question": "q", "choices": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]}),
    );
    refused(json!({"question": "q", "choices": [{"id": "a".repeat(65), "label": "A"}]}));
    refused(json!({"question": "q", "choices": [{"id": "a b", "label": "A"}]}));

    // The edges are allowed: 10 choices, 200-character labels, a 2,000-character question.
    let file = request_file(
        home.path(),
        "edge.json",
        &json!({"question": "q".repeat(2000), "choices": choices(10, 200)}),
    );
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &std::fs::read_to_string(file).unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(
        card(home.path())["pendingChoices"]
            .as_array()
            .unwrap()
            .len(),
        10
    );
}

#[test]
fn a_request_without_choices_is_refused_and_nothing_changes() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let value = json!({"question": "Just a question?", "choices": []}).to_string();
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &value,
        ],
    );
    assert_eq!((code, code_name.as_str()), (2, "invalid_value"));
    assert_eq!(card(home.path())["agentStatus"], "idle");
}

#[test]
fn a_request_that_is_not_json_is_refused_and_changes_nothing() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            "not json",
        ],
    );
    assert_eq!((code, code_name.as_str()), (2, "invalid_value"));
    assert_eq!(card(home.path())["agentStatus"], "idle");
}

#[test]
fn a_request_read_from_standard_input_keeps_its_question_and_choices() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home.path())
        .env("TZ", "UTC")
        .args([
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-json",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(three_choices().to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let shown = card(home.path());
    assert_eq!(shown["pendingReason"], "Which plan should we use?");
    assert_eq!(shown["pendingChoices"].as_array().unwrap().len(), 3);
}

fn choices(count: usize) -> Value {
    let choices: Vec<Value> = (0..count)
        .map(|i| json!({"id": format!("c{i}"), "label": format!("Option {i}")}))
        .collect();
    json!({"question": "How many?", "choices": choices})
}

#[test]
fn a_request_with_fewer_than_two_or_more_than_ten_choices_is_refused() {
    for count in [0, 1, 11] {
        let home = tempfile::tempdir().unwrap();
        demo_project(home.path());
        let value = choices(count).to_string();
        let (code, code_name) = json_error(
            home.path(),
            &[
                "--project",
                "Demo",
                "state",
                "1",
                "pending",
                "--actor",
                "ai",
                "--request-json",
                &value,
            ],
        );
        assert_eq!(
            (code, code_name.as_str()),
            (2, "invalid_value"),
            "{count} choices"
        );
        assert_eq!(card(home.path())["agentStatus"], "idle", "{count} choices");
    }
}

#[test]
fn a_reason_only_pending_state_is_refused_and_nothing_changes() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--reason",
            "Which one?",
        ],
    );
    assert_eq!((code, code_name.as_str()), (2, "invalid_argument"));
    assert_eq!(card(home.path())["agentStatus"], "idle");
}

#[test]
fn request_file_is_gone_and_help_shows_request_json_with_an_example() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            "1",
            "pending",
            "--actor",
            "ai",
            "--request-file",
            "q.json",
        ],
    );
    assert_ne!(code, 0, "{err}");
    assert!(err.contains("--request-file"), "{err}");
    let (code, out, _) = agboard(home.path(), &["state", "--help"]);
    assert_eq!(code, 0);
    assert!(out.contains("--request-json"), "{out}");
    assert!(out.contains("\"choices\""), "{out}");
    assert!(!out.contains("--request-file"), "{out}");
}

/// A new AI card in todo, read back by ID.
fn todo_card(home: &Path, title: &str) -> String {
    let created = json_ok(
        home,
        &[
            "--project",
            "Demo",
            "add",
            title,
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--json",
        ],
    );
    created["card"]["id"].as_i64().unwrap().to_string()
}

/// Put card `id` into a pending request from `value` and return the request ID.
fn ask_card(home: &Path, id: &str, value: &Value) -> String {
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "state",
            id,
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &value.to_string(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    card_of(home, id)["pendingRequestId"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn a_todo_card_asks_and_the_answer_returns_it_to_todo_idle() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let id = todo_card(home.path(), "Ask in todo");
    let request = ask_card(home.path(), &id, &three_choices());
    let shown = card_of(home.path(), &id);
    assert_eq!(shown["cardStatus"], "todo");
    assert_eq!(shown["agentStatus"], "pending");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &id,
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--choice",
            "proceed",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let shown = card_of(home.path(), &id);
    assert_eq!(shown["cardStatus"], "todo");
    assert_eq!(shown["agentStatus"], "idle");
    assert_eq!(shown["pendingRequestId"], Value::Null);
}

#[test]
fn run_states_refused_outside_their_column_or_owner_leave_the_card_unchanged() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    // An AI card in todo may not run.
    let id = todo_card(home.path(), "Run in todo");
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &id,
            "running",
            "--actor",
            "ai",
            "--reason",
            "Working",
        ],
    );
    assert_ne!(code, 0);
    assert_eq!(card_of(home.path(), &id)["agentStatus"], "idle");
    // A person's card may not be pending.
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "add",
            "Mine",
            "--assignee",
            "human",
            "--actor",
            "human",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let mine = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"])["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "Mine")
        .unwrap()["id"]
        .as_i64()
        .unwrap()
        .to_string();
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &mine,
            "pending",
            "--actor",
            "human",
            "--request-json",
            &three_choices().to_string(),
        ],
    );
    assert_ne!(code, 0);
    assert_eq!(card_of(home.path(), &mine)["agentStatus"], "idle");
    // An AI card in done may not be pending.
    let done = todo_card(home.path(), "Done already");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &done,
            "done",
            "--actor",
            "human",
            "--reason",
            "Finished.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (code, _, _) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &done,
            "pending",
            "--actor",
            "ai",
            "--request-json",
            &three_choices().to_string(),
        ],
    );
    assert_ne!(code, 0);
    assert_eq!(card_of(home.path(), &done)["agentStatus"], "idle");
}

#[test]
fn moving_a_todo_card_cancels_its_request_and_the_old_answer_is_refused() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let id = todo_card(home.path(), "Move while asking");
    let request = ask_card(home.path(), &id, &three_choices());
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "mv",
            &id,
            "doing",
            "--actor",
            "human",
            "--reason",
            "Start.",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let shown = card_of(home.path(), &id);
    assert_eq!(shown["agentStatus"], "idle");
    assert_eq!(shown["pendingRequestId"], Value::Null);
    let (code, code_name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "state",
            &id,
            "idle",
            "--actor",
            "human",
            "--request",
            &request,
            "--reason",
            "Too late.",
        ],
    );
    assert_ne!(code, 0);
    assert_ne!(code_name, "", "{code}");
}

fn card_of(home: &Path, id: &str) -> Value {
    json_ok(home, &["--project", "Demo", "show", id, "--json"])["card"].clone()
}
