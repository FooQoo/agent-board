//! The Summary's `messages` (questions, requests and approvals in one shape) and the rule that
//! a send waits for the answers to questions about the plan. Every test uses a temporary
//! data area; servers listen on port 0.

mod common;

use agent_board::domain::{Actor, Assignee, Column, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::message::messages;
use agent_board::file_store::model::NewEpic;
use agent_board::file_store::qa::AnswerVia;
use agent_board::file_store::validate::EpicId;
use agent_board::file_store::{AnswerItem, AskInput, AskQuestion, FileStore, SendRequestInput};
use chrono::{DateTime, TimeZone, Utc};
use common::{Running, agboard, demo_project, json_error, json_ok};
use serde_json::json;

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 9, minute, 0).unwrap()
}

struct Fx {
    _root: tempfile::TempDir,
    store: FileStore,
    project: ProjectId,
}

fn fx() -> Fx {
    let root = tempfile::tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let project = store.create_project("Alpha", at(0)).unwrap().id;
    Fx {
        _root: root,
        store,
        project,
    }
}

impl Fx {
    fn task(&self, title: &str, actor: Actor, epic: Option<&str>, minute: u32) -> i64 {
        let new = NewTask {
            title: title.into(),
            description: String::new(),
            assignee: Assignee::Ai,
            actor,
            draft: None,
        };
        // A plan an agent makes waits in the Backlog.
        let id = if actor == Actor::Ai {
            self.store
                .create_task_in_backlog(&self.project, new, at(minute))
        } else {
            self.store.create_task(&self.project, new, at(minute))
        }
        .unwrap()
        .id;
        if let Some(epic) = epic {
            self.store
                .set_task_epic(
                    &self.project,
                    id,
                    Some(&EpicId::normalize(epic).unwrap()),
                    Actor::Ai,
                    at(minute),
                )
                .unwrap();
        }
        id
    }

    fn epic(&self, id: &str, name: &str, minute: u32) -> EpicId {
        self.store
            .create_epic(
                &self.project,
                NewEpic {
                    id: id.into(),
                    name: name.into(),
                    color: None,
                    draft: None,
                    document: None,
                },
                at(minute),
            )
            .unwrap()
            .id
    }

    fn ask(&self, body: &str, tasks: &[i64], minute: u32) -> String {
        self.store
            .ask_questions(
                &self.project,
                AskInput {
                    actor: Actor::Ai,
                    asked_by: None,
                    questions: vec![AskQuestion {
                        body: body.into(),
                        choices: Vec::new(),
                        recommended_choice_id: None,
                        tasks: Vec::new(),
                        images: Vec::new(),
                    }],
                    tasks: tasks.to_vec(),
                },
                at(minute),
            )
            .unwrap()
            .remove(0)
            .id
    }

    fn answer(&self, id: &str, minute: u32) {
        self.store
            .answer_questions(
                &self.project,
                vec![AnswerItem {
                    question_id: id.into(),
                    choice_id: None,
                    text: Some("ok".into()),
                    images: Vec::new(),
                }],
                AnswerVia::Cli,
                at(minute),
            )
            .unwrap();
    }

    fn list(&self) -> Vec<serde_json::Value> {
        let snapshot = self.store.snapshot(&self.project).unwrap();
        serde_json::to_value(messages(&snapshot))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }
}

#[test]
fn a_question_is_the_humans_turn_until_it_is_answered_then_the_agents_until_it_is_accepted() {
    let f = fx();
    let task = f.task("Work", Actor::Human, None, 1);
    let id = f.ask("## Which database?\nDetails", &[task], 2);
    let list = f.list();
    assert_eq!(
        list,
        vec![json!({
            "id": id, "type": "question", "from": "ai", "to": "human", "turn": "human",
            "title": "Which database?", "createdAt": "2026-11-17T09:02:00Z",
            "tasks": [task], "epicId": null,
        })]
    );
    f.answer(&id, 3);
    let list = f.list();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["turn"], "ai", "the answer waits for an agent");
    f.store
        .accept_message(&f.project, &id, Actor::Ai, at(4))
        .unwrap();
    assert!(f.list().is_empty(), "an accepted answer is over");
}

#[test]
fn a_request_is_the_agents_turn_until_it_is_accepted_or_withdrawn() {
    let f = fx();
    let send = |text: &str, minute| {
        f.store
            .send_request(
                &f.project,
                SendRequestInput {
                    text: text.into(),
                    images: Vec::new(),
                },
                at(minute),
            )
            .unwrap()
            .id
    };
    let one = send("Add dark mode\nplease", 1);
    let two = send("Drop it", 2);
    let list = f.list();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["id"], one);
    assert_eq!(
        (&list[0]["type"], &list[0]["from"], &list[0]["to"]),
        (&json!("request"), &json!("human"), &json!("ai"))
    );
    assert_eq!(list[0]["turn"], "ai");
    assert_eq!(list[0]["title"], "Add dark mode");
    f.store
        .accept_message(&f.project, &one, Actor::Ai, at(3))
        .unwrap();
    f.store
        .withdraw_message(&f.project, &two, Actor::Human, at(4))
        .unwrap();
    assert!(f.list().is_empty());
}

#[test]
fn a_send_is_a_warning_for_a_person_while_a_question_about_it_has_no_answer() {
    let f = fx();
    let task = f.task("Plan", Actor::Ai, None, 1);
    let q = f.ask("Which way?", &[task], 3);
    let warned = f
        .store
        .send_task(&f.project, task, Actor::Human, false, at(4))
        .unwrap_err();
    assert!(
        matches!(&warned, AgboardError::SendWithOpenQuestions { ids } if ids.as_slice() == std::slice::from_ref(&q))
    );
    assert_eq!(
        f.store.task(&f.project, task).unwrap().task_status,
        Column::Backlog
    );
    assert!(
        f.store
            .send_task(&f.project, task, Actor::Human, true, at(5))
            .is_ok()
    );
}

#[test]
fn an_epic_send_is_a_warning_while_a_question_about_its_cards_has_no_answer() {
    let f = fx();
    let epic = f.epic("PLAN", "Plan", 1);
    let one = f.task("One", Actor::Ai, Some("PLAN"), 2);
    let two = f.task("Two", Actor::Ai, Some("PLAN"), 3);
    let unrelated = f.task("Elsewhere", Actor::Ai, None, 4);
    f.ask("About elsewhere", &[unrelated], 5);
    let q = f.ask("About two", &[two], 6);
    let warned = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Human, false, at(7))
        .unwrap_err();
    assert!(
        matches!(&warned, AgboardError::SendWithOpenQuestions { ids } if ids.as_slice() == std::slice::from_ref(&q))
    );
    assert_eq!(
        f.store.task(&f.project, one).unwrap().task_status,
        Column::Backlog,
        "nothing is sent"
    );
    f.answer(&q, 8);
    let sent = f
        .store
        .send_epic(&f.project, &epic, None, Actor::Human, false, at(9))
        .unwrap();
    assert_eq!(sent.value.sent, vec![one, two]);
}

#[test]
fn the_cli_and_the_api_name_the_unanswered_questions_and_the_summary_lists_messages() {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    let run = |args: &[&str]| {
        let mut all = vec!["--project", "Demo"];
        all.extend(args);
        json_ok(home.path(), &[&all[..], &["--json"]].concat())
    };
    run(&[
        "add",
        "Plan A",
        "--assignee",
        "ai",
        "--actor",
        "ai",
        "--backlog",
    ]);
    run(&[
        "add",
        "Plan B",
        "--assignee",
        "ai",
        "--actor",
        "ai",
        "--backlog",
    ]);
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "message",
            "ask",
            "--actor",
            "ai",
            "--task",
            "2",
            "--questions-json",
            r#"{"questions":[{"body":"Which?"}]}"#,
            "--no-wait",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");

    // A person is warned and confirms with --force; an agent cannot send.
    let (code, name) = json_error(
        home.path(),
        &[
            "--project",
            "Demo",
            "send",
            "2",
            "--actor",
            "human",
            "--json",
        ],
    );
    assert_eq!((code, name.as_str()), (1, "send_with_open_questions"));
    let (_, _, err_text) = agboard(
        home.path(),
        &["--project", "Demo", "send", "2", "--actor", "human"],
    );
    assert!(err_text.contains("Q-1"), "{err_text}");

    let pid = json_ok(home.path(), &["project", "ls", "--json"])["projects"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let server = Running::start(home.path());
    let summary = server.get(&format!("/api/projects/{pid}/summary")).json();
    let list = summary["messages"].as_array().unwrap();
    let kinds: Vec<_> = list
        .iter()
        .map(|x| (x["type"].as_str().unwrap(), x["id"].as_str().unwrap()))
        .collect();
    assert_eq!(kinds, [("question", "Q-1")]);
    server.stop();

    // Answer it, and the person sends the task without a warning.
    let (code, _, err) = agboard(
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
            "A",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{err}");
    let started = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "send",
            "2",
            "--actor",
            "human",
            "--json",
        ],
    );
    assert_eq!(started["task"]["taskStatus"], "todo");
}
