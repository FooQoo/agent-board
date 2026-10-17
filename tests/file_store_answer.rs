//! Decision requests and answers on the shared files (AC-5): a request with
//! choices, a reason-only request, answers by choice, by text, or by both,
//! and the refusals (empty answer, unknown choice, replaced request).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::model::Choice;
use agent_board::file_store::{Answer, FileStore};
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}

fn later() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 5, 0, 0, 0).unwrap()
}

fn choice(id: &str, label: &str) -> Choice {
    Choice {
        id: id.into(),
        label: label.into(),
    }
}

fn proceed_choices() -> Vec<Choice> {
    vec![
        choice("proceed", "Proceed as planned"),
        choice("revise", "Revise the plan"),
    ]
}

fn answer(choice_id: Option<&str>, text: Option<&str>) -> Answer {
    Answer {
        actor: Actor::Human,
        choice_id: choice_id.map(str::to_string),
        text: text.map(str::to_string),
    }
}

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", now()).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

impl Fixture {
    /// An AI task in Doing, ready to ask a question.
    fn working_task(&self) -> i64 {
        let id = self
            .store
            .create_task(
                &self.project,
                NewTask {
                    title: "work".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                now(),
            )
            .unwrap()
            .id;
        self.store
            .move_work_task(
                &self.project,
                id,
                Column::Doing,
                ChangeContext {
                    actor: Actor::Ai,
                    reason: "Start".into(),
                },
                now(),
            )
            .unwrap();
        id
    }

    fn task_path(&self, id: i64) -> PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("tasks")
            .join(id.to_string())
            .join("task.json")
    }

    /// A pending request with no choices.
    fn legacy_reason_only(&self, id: i64, question: &str) -> String {
        let asked = self
            .store
            .request_decision(&self.project, id, Actor::Ai, question, vec![], later())
            .unwrap();
        asked.value.pending_request_id.unwrap()
    }

    fn history(&self, id: i64) -> serde_json::Value {
        let markdown = fs::read_to_string(self.task_path(id).with_file_name("TASK.md")).unwrap();
        let parsed = agent_board::file_store::history::parse_task(
            &markdown,
            agent_board::file_store::history::ParseMode::Stored,
        );
        serde_json::to_value(parsed.history).unwrap()
    }

    fn bytes(&self, id: i64) -> Vec<u8> {
        fs::read(self.task_path(id)).unwrap()
    }
}

fn is_hex32(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[test]
fn a_request_with_choices_is_saved_in_metadata_and_shown_on_the_task() {
    let fx = fixture();
    let id = fx.working_task();
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    assert!(asked.changed);
    assert_eq!(asked.value.agent_status, RunState::Pending);
    assert!(is_hex32(asked.value.pending_request_id.as_deref().unwrap()));
    assert_eq!(asked.value.pending_reason.as_deref(), Some("Proceed?"));
    assert_eq!(asked.value.pending_choices, proceed_choices());

    let last = fx.history(id).as_array().unwrap().last().unwrap().clone();
    assert_eq!(last.as_object().unwrap().len(), 2);
    assert!(last["reason"].as_str().unwrap().contains("Proceed?"));
    let metadata: serde_json::Value = serde_json::from_slice(&fx.bytes(id)).unwrap();
    assert_eq!(metadata["pendingRequest"]["question"], "Proceed?");
    assert_eq!(metadata["pendingRequest"]["choices"][0]["id"], "proceed");
    assert_eq!(
        metadata["pendingRequest"]["choices"][1]["label"],
        "Revise the plan"
    );
}

#[test]
fn a_choice_only_answer_returns_the_task_to_idle_and_records_the_choice() {
    let fx = fixture();
    let id = fx.working_task();
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    let request = asked.value.pending_request_id.clone().unwrap();

    let task = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap();
    assert_eq!(task.agent_status, RunState::Idle);
    assert!(task.pending_request_id.is_none());
    assert!(task.pending_reason.is_none());
    assert!(task.pending_choices.is_empty());

    let last = fx.history(id).as_array().unwrap().last().unwrap().clone();
    assert_eq!(last.as_object().unwrap().len(), 2);
    assert!(
        last["reason"]
            .as_str()
            .unwrap()
            .contains("Proceed as planned")
    );
    let response = fx
        .store
        .request_answer(&fx.project, id, &request)
        .unwrap()
        .unwrap();
    assert_eq!(response.choice_id.as_deref(), Some("proceed"));
    assert_eq!(response.choice_label.as_deref(), Some("Proceed as planned"));
    assert_eq!(response.text, None);
}

#[test]
fn a_text_answer_works_for_a_reason_only_request() {
    let fx = fixture();
    let id = fx.working_task();
    let request = fx.legacy_reason_only(id, "Which way?");
    let asked = fx.store.task(&fx.project, id).unwrap();
    assert_eq!(asked.pending_reason.as_deref(), Some("Which way?"));
    assert!(asked.pending_choices.is_empty());

    let task = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(None, Some("Use option B")),
            later(),
        )
        .unwrap();
    assert_eq!(task.agent_status, RunState::Idle);
    let last = fx.history(id).as_array().unwrap().last().unwrap().clone();
    assert!(last["reason"].as_str().unwrap().contains("Use option B"));
    assert_eq!(
        fx.store
            .request_answer(&fx.project, id, &request)
            .unwrap()
            .unwrap()
            .text
            .as_deref(),
        Some("Use option B")
    );
    assert!(last.get("choiceId").is_none() || last["choiceId"].is_null());
}

#[test]
fn an_answer_with_a_choice_and_a_note_stores_both() {
    let fx = fixture();
    let id = fx.working_task();
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    let request = asked.value.pending_request_id.unwrap();

    fx.store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(Some("revise"), Some("Keep the tests")),
            later(),
        )
        .unwrap();
    let last = fx.history(id).as_array().unwrap().last().unwrap().clone();
    assert!(last["reason"].as_str().unwrap().contains("Revise the plan"));
    assert!(last["reason"].as_str().unwrap().contains("Keep the tests"));
    let response = fx
        .store
        .request_answer(&fx.project, id, &request)
        .unwrap()
        .unwrap();
    assert_eq!(response.choice_id.as_deref(), Some("revise"));
    assert_eq!(response.choice_label.as_deref(), Some("Revise the plan"));
    assert_eq!(response.text.as_deref(), Some("Keep the tests"));
}

#[test]
fn an_empty_answer_is_refused_and_changes_nothing() {
    let fx = fixture();
    let id = fx.working_task();
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    let request = asked.value.pending_request_id.unwrap();
    let before = fx.bytes(id);

    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(None, Some("   ")),
            later(),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    let err = fx
        .store
        .answer_request(&fx.project, id, &request, answer(None, None), later())
        .unwrap_err();
    assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn an_unknown_choice_is_refused_and_changes_nothing() {
    let fx = fixture();
    let id = fx.working_task();
    let asked = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    let request = asked.value.pending_request_id.unwrap();
    let before = fx.bytes(id);

    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(Some("nope"), None),
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::RequestChoiceUnknown { .. }),
        "{err:?}"
    );
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_choice_is_unknown_for_a_reason_only_request() {
    let fx = fixture();
    let id = fx.working_task();
    let request = fx.legacy_reason_only(id, "Which way?");
    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::RequestChoiceUnknown { .. }),
        "{err:?}"
    );
}

#[test]
fn an_answer_to_a_resolved_or_replaced_request_is_refused() {
    let fx = fixture();
    let id = fx.working_task();
    let first = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "First?",
            proceed_choices(),
            later(),
        )
        .unwrap()
        .value
        .pending_request_id
        .unwrap();
    fx.store
        .answer_request(
            &fx.project,
            id,
            &first,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap();

    // The same request answered twice.
    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &first,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::RequestChanged), "{err:?}");

    // A new request replaces the old one; the old ID no longer answers.
    let second = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Second?",
            proceed_choices(),
            later(),
        )
        .unwrap()
        .value
        .pending_request_id
        .unwrap();
    assert_ne!(first, second);
    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &first,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::RequestChanged), "{err:?}");
    fx.store
        .answer_request(
            &fx.project,
            id,
            &second,
            answer(Some("revise"), None),
            later(),
        )
        .unwrap();
}

#[test]
fn an_answer_to_a_task_that_is_not_pending_is_refused() {
    let fx = fixture();
    let id = fx.working_task();
    let err = fx
        .store
        .answer_request(
            &fx.project,
            id,
            "ffffffffffffffffffffffffffffffff",
            answer(None, Some("hello")),
            later(),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::RequestChanged), "{err:?}");
}

#[test]
fn the_choices_and_the_question_are_limited() {
    let fx = fixture();
    let id = fx.working_task();
    let before = fx.bytes(id);
    let eleven: Vec<Choice> = (0..11).map(|i| choice(&format!("c{i}"), "Label")).collect();
    let bad_cases: Vec<(String, Vec<Choice>)> = vec![
        ("Proceed?".into(), eleven),
        (
            "Proceed?".into(),
            vec![choice("a", "one"), choice("a", "two")],
        ),
        ("Proceed?".into(), vec![choice("a b", "one")]),
        ("Proceed?".into(), vec![choice("ok", "")]),
        ("   ".into(), Vec::new()),
        ("q".repeat(2_001), Vec::new()),
    ];
    for (question, choices) in bad_cases {
        let err = fx
            .store
            .request_decision(&fx.project, id, Actor::Ai, &question, choices, later())
            .unwrap_err();
        assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    }
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_pending_request_is_read_back_from_the_files_until_it_is_answered() {
    let fx = fixture();
    let id = fx.working_task();
    fx.store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Proceed?",
            proceed_choices(),
            later(),
        )
        .unwrap();
    let reopened = FileStore::open(&fx.shared);
    let task = reopened.task(&fx.project, id).unwrap();
    assert_eq!(task.agent_status, RunState::Pending);
    assert_eq!(task.pending_reason.as_deref(), Some("Proceed?"));
    assert_eq!(task.pending_choices, proceed_choices());
}
