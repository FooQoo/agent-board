//! Decision-request cardinality at the input and persistence boundaries.

mod common;

use agent_board::domain::{Actor, Assignee, NewTask};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use agent_board::file_store::validate::normalize_choices;
use chrono::Timelike;
use common::{agboard, demo_project, json_ok};
use serde_json::{Value, json};

fn choices(count: usize) -> Vec<Choice> {
    (0..count)
        .map(|i| Choice {
            id: format!("c{i}"),
            label: format!("Option {i}"),
        })
        .collect()
}

fn request(count: usize) -> String {
    json!({"question": "Which plan?", "choices": choices(count)}).to_string()
}

#[test]
fn request_choices_require_two_to_ten_items() {
    for count in [0, 1, 11] {
        match normalize_choices(choices(count)).unwrap_err() {
            AgboardError::InvalidValue { field, reason } => {
                assert_eq!(field, "choices");
                assert!(reason.contains("2 to 10 choices"), "{count}: {reason}");
            }
            other => panic!("{count}: {other:?}"),
        }
    }
    for count in [2, 10] {
        assert_eq!(normalize_choices(choices(count)).unwrap().len(), count);
    }
}

#[test]
fn cli_refuses_missing_zero_one_and_eleven_choices_without_saving() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    for value in [
        json!({"question": "Which plan?"}).to_string(),
        request(0),
        request(1),
        request(11),
    ] {
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
                &value,
                "--json",
            ],
        );
        assert_eq!(code, 2, "{value}: {err}");
        assert!(err.contains("2 to 10 choices"), "{err}");
        let shown = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
        assert_eq!(shown["task"]["agentStatus"], "idle");
        assert_eq!(shown["task"]["pendingRequestId"], Value::Null);
        assert_eq!(shown["task"]["history"].as_array().unwrap().len(), 2);
    }
}

#[test]
fn cli_accepts_two_and_ten_choices() {
    for count in [2, 10] {
        let home = tempfile::tempdir().unwrap();
        demo_project(home.path());
        let asked = json_ok(
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
                &request(count),
                "--json",
            ],
        );
        assert_eq!(asked["task"]["agentStatus"], "pending");
        assert_eq!(
            asked["task"]["pendingChoices"].as_array().unwrap().len(),
            count
        );
    }
}

#[test]
fn stored_pending_requests_require_two_to_ten_choices() {
    let home = tempfile::tempdir().unwrap();
    let shared = home.path().join("shared");
    let store = FileStore::open(&shared);
    let now = chrono::Utc::now().with_nanosecond(0).unwrap();
    let project = store.create_project("Demo", now).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Decide".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            now,
        )
        .unwrap();
    store
        .request_decision(&project, task.id, Actor::Ai, "Which plan?", choices(2), now)
        .unwrap();
    let path = shared
        .join("projects")
        .join(project.as_str())
        .join("tasks")
        .join(task.id.to_string())
        .join("task.json");
    let mut saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for count in [0, 1, 2, 10, 11] {
        saved["pendingRequest"]["choices"] = serde_json::to_value(choices(count)).unwrap();
        std::fs::write(&path, serde_json::to_vec_pretty(&saved).unwrap()).unwrap();
        if [2, 10].contains(&count) {
            assert_eq!(
                store.task(&project, task.id).unwrap().pending_choices.len(),
                count
            );
        } else {
            match store.task(&project, task.id).unwrap_err() {
                AgboardError::FileInvalid { field, reason, .. } => {
                    assert_eq!(field, "pendingRequest.choices");
                    assert!(reason.contains("2 to 10 choices"), "{reason}");
                }
                other => panic!("{count}: {other:?}"),
            }
        }
    }
}

#[test]
fn valid_requests_still_accept_choice_text_and_both_answers() {
    for (choice, note) in [(true, false), (false, true), (true, true)] {
        let home = tempfile::tempdir().unwrap();
        demo_project(home.path());
        let asked = json_ok(
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
                &request(2),
                "--json",
            ],
        );
        let request_id = asked["task"]["pendingRequestId"].as_str().unwrap();
        let mut args = vec![
            "--project",
            "Demo",
            "state",
            "1",
            "idle",
            "--actor",
            "human",
            "--request",
            request_id,
            "--json",
        ];
        if choice {
            args.extend(["--choice", "c0"]);
        }
        if note {
            args.extend(["--reason", "Use a revised plan."]);
        }
        json_ok(home.path(), &args);
        // Read persisted metadata again, so a selected answer is not accidentally
        // validated as a new one-choice request.
        let shown = json_ok(home.path(), &["--project", "Demo", "show", "1", "--json"]);
        assert_eq!(shown["task"]["agentStatus"], "idle");
        let history = shown["task"]["history"].as_array().unwrap();
        let reason = history.last().unwrap()["reason"].as_str().unwrap();
        assert_eq!(reason.contains("Selected: Option 0"), choice);
        assert_eq!(reason.contains("Answer: Use a revised plan."), note);
    }
}

#[test]
fn state_help_requires_two_to_ten_choices() {
    let home = tempfile::tempdir().unwrap();
    let (code, out, err) = agboard(home.path(), &["state", "--help"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("2 to 10 choices"), "{out}");
    assert!(!out.contains("0 to 10 choices"), "{out}");
}

#[test]
fn plain_state_change_cannot_create_a_request_without_choices() {
    use agent_board::domain::{ChangeContext, RunState};
    let home = tempfile::tempdir().unwrap();
    let store = FileStore::open(&home.path().join("shared"));
    let now = chrono::Utc::now().with_nanosecond(0).unwrap();
    let project = store.create_project("Demo", now).unwrap().id;
    let task = store
        .create_task(
            &project,
            NewTask {
                title: "Decide".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                is_draft: false,
            },
            now,
        )
        .unwrap();
    let result = store.set_agent_status(
        &project,
        task.id,
        RunState::Pending,
        ChangeContext {
            actor: Actor::Ai,
            reason: "Which plan?".into(),
        },
        None,
        now,
    );
    assert!(matches!(result, Err(AgboardError::InvalidValue { field, .. }) if field == "choices"));
    assert_eq!(
        store.task(&project, task.id).unwrap().agent_status,
        RunState::Idle
    );
}
