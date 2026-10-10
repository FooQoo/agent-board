//! Decision requests and answers on the shared files (AC-5): a request with
//! choices, a reason-only request, answers by choice, by text, or by both,
//! and the refusals (empty answer, unknown choice, replaced request).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewCard, ProjectId, RunState};
use agent_board::error::SkanError;
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
    /// An AI card in Doing, ready to ask a question.
    fn working_card(&self) -> i64 {
        let id = self
            .store
            .create_card(
                &self.project,
                NewCard {
                    title: "work".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                },
                now(),
            )
            .unwrap()
            .id;
        self.store
            .move_work_card(
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

    fn raw(&self, id: i64) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(self.task_path(id)).unwrap()).unwrap()
    }

    fn bytes(&self, id: i64) -> Vec<u8> {
        fs::read(self.task_path(id)).unwrap()
    }
}

fn is_hex32(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[test]
fn a_request_with_choices_is_saved_in_history_and_shown_on_the_card() {
    let fx = fixture();
    let id = fx.working_card();
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

    let last = fx.raw(id)["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["kind"], "agent");
    assert_eq!(last["toAgentStatus"], "pending");
    assert_eq!(last["question"], "Proceed?");
    assert_eq!(last["choices"][0]["id"], "proceed");
    assert_eq!(last["choices"][1]["label"], "Revise the plan");
}

#[test]
fn a_choice_only_answer_returns_the_card_to_idle_and_records_the_choice() {
    let fx = fixture();
    let id = fx.working_card();
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

    let card = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(Some("proceed"), None),
            later(),
        )
        .unwrap();
    assert_eq!(card.agent_status, RunState::Idle);
    assert!(card.pending_request_id.is_none());
    assert!(card.pending_reason.is_none());
    assert!(card.pending_choices.is_empty());

    let last = fx.raw(id)["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["kind"], "answer");
    assert_eq!(last["requestId"], request);
    assert_eq!(last["choiceId"], "proceed");
    assert_eq!(last["choiceLabel"], "Proceed as planned");
    assert!(last["reason"].is_null(), "a choice-only answer has no text");
}

#[test]
fn a_text_answer_works_for_a_reason_only_request() {
    let fx = fixture();
    let id = fx.working_card();
    let asked = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Pending,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Which way?".into(),
            },
            None,
            later(),
        )
        .unwrap();
    assert_eq!(asked.value.pending_reason.as_deref(), Some("Which way?"));
    assert!(asked.value.pending_choices.is_empty());
    let request = asked.value.pending_request_id.unwrap();

    let card = fx
        .store
        .answer_request(
            &fx.project,
            id,
            &request,
            answer(None, Some("Use option B")),
            later(),
        )
        .unwrap();
    assert_eq!(card.agent_status, RunState::Idle);
    let last = fx.raw(id)["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["kind"], "answer");
    assert_eq!(last["reason"], "Use option B");
    assert!(last.get("choiceId").is_none() || last["choiceId"].is_null());
}

#[test]
fn an_answer_with_a_choice_and_a_note_stores_both() {
    let fx = fixture();
    let id = fx.working_card();
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
    let last = fx.raw(id)["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    assert_eq!(last["choiceId"], "revise");
    assert_eq!(last["choiceLabel"], "Revise the plan");
    assert_eq!(last["reason"], "Keep the tests");
}

#[test]
fn an_empty_answer_is_refused_and_changes_nothing() {
    let fx = fixture();
    let id = fx.working_card();
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
    assert!(matches!(err, SkanError::InvalidValue { .. }), "{err:?}");
    let err = fx
        .store
        .answer_request(&fx.project, id, &request, answer(None, None), later())
        .unwrap_err();
    assert!(matches!(err, SkanError::InvalidValue { .. }), "{err:?}");
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn an_unknown_choice_is_refused_and_changes_nothing() {
    let fx = fixture();
    let id = fx.working_card();
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
        matches!(err, SkanError::RequestChoiceUnknown { .. }),
        "{err:?}"
    );
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_choice_is_unknown_for_a_reason_only_request() {
    let fx = fixture();
    let id = fx.working_card();
    let asked = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Pending,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Which way?".into(),
            },
            None,
            later(),
        )
        .unwrap();
    let request = asked.value.pending_request_id.unwrap();
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
        matches!(err, SkanError::RequestChoiceUnknown { .. }),
        "{err:?}"
    );
}

#[test]
fn an_answer_to_a_resolved_or_replaced_request_is_refused() {
    let fx = fixture();
    let id = fx.working_card();
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
    assert!(matches!(err, SkanError::RequestChanged), "{err:?}");

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
    assert!(matches!(err, SkanError::RequestChanged), "{err:?}");
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
fn an_answer_to_a_card_that_is_not_pending_is_refused() {
    let fx = fixture();
    let id = fx.working_card();
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
    assert!(matches!(err, SkanError::RequestChanged), "{err:?}");
}

#[test]
fn the_choices_and_the_question_are_limited() {
    let fx = fixture();
    let id = fx.working_card();
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
        assert!(matches!(err, SkanError::InvalidValue { .. }), "{err:?}");
    }
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_pending_request_is_read_back_from_the_files_until_it_is_answered() {
    let fx = fixture();
    let id = fx.working_card();
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
    let card = reopened.card(&fx.project, id).unwrap();
    assert_eq!(card.agent_status, RunState::Pending);
    assert_eq!(card.pending_reason.as_deref(), Some("Proceed?"));
    assert_eq!(card.pending_choices, proceed_choices());
}
