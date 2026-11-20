//! Push mode: the launcher watches a real board in a temporary folder and sends work to an idle
//! scripted session through `send_user_message`.

use chrono::Utc;

use super::health::{fast, no_projects};
use super::*;
use crate::domain::{Actor, Assignee, ChangeContext, Column, NewTask, RunState};
use crate::file_store::{AskInput, AskQuestion, FileStore, SendRequestInput};
use crate::server::resident::driver::mock::{Call, Calls, Step, factory_replying};
use crate::server::resident::driver::{DriverEvent, TurnOutcome};

pub(super) struct Board {
    _root: TempDir,
    shared: std::path::PathBuf,
    pub(super) store: FileStore,
    pub(super) id: ProjectId,
}

pub(super) fn board() -> Board {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let id = store.create_project("Demo", Utc::now()).unwrap().id;
    Board {
        _root: root,
        shared,
        store,
        id,
    }
}

impl Board {
    fn request(&self, text: &str) -> String {
        self.store
            .send_request(
                &self.id,
                SendRequestInput {
                    text: text.into(),
                    images: Vec::new(),
                },
                Utc::now(),
            )
            .unwrap()
            .id
    }

    fn accept(&self, id: &str) {
        self.store
            .accept_message(&self.id, id, Actor::Ai, Utc::now())
            .unwrap();
    }

    fn ask(&self, asked_by: Option<&str>, body: &str) -> String {
        self.store
            .ask_questions(
                &self.id,
                AskInput {
                    actor: Actor::Ai,
                    asked_by: asked_by.map(str::to_string),
                    questions: vec![AskQuestion {
                        body: body.into(),
                        choices: Vec::new(),
                        recommended_choice_id: None,
                        tasks: Vec::new(),
                        images: Vec::new(),
                    }],
                    tasks: Vec::new(),
                },
                Utc::now(),
            )
            .unwrap()
            .remove(0)
            .id
    }

    fn answer(&self, id: &str) {
        self.store
            .answer_questions(
                &self.id,
                vec![crate::file_store::AnswerItem {
                    question_id: id.into(),
                    choice_id: None,
                    text: Some("Yes".into()),
                }],
                crate::file_store::qa::AnswerVia::Cli,
                Utc::now(),
            )
            .unwrap();
    }

    pub(super) fn task(&self, title: &str, assignee: Assignee) -> i64 {
        self.store
            .create_task(
                &self.id,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee,
                    actor: Actor::Human,
                    draft: None,
                },
                Utc::now(),
            )
            .unwrap()
            .id
    }

    pub(super) fn run(&self, id: i64) {
        let ctx = || ChangeContext {
            actor: Actor::Ai,
            reason: "Start".into(),
        };
        self.store
            .move_work_task(&self.id, id, Column::Doing, ctx(), Utc::now())
            .unwrap();
        self.store
            .set_agent_status(&self.id, id, RunState::Running, ctx(), Utc::now())
            .unwrap();
    }
}

pub(super) fn turn_ends() -> Vec<Step> {
    vec![
        Step::Event(DriverEvent::Started {
            session_id: Some("s".into()),
            tool_version: None,
        }),
        Step::Event(DriverEvent::TurnEnded(TurnOutcome::Completed)),
    ]
}

/// A launcher over `board` whose session starts idle (its launch turn ends at once) and plays
/// `reply` after each message.
pub(super) fn session(board: &Board, start: Vec<Step>, reply: Vec<Step>) -> (Fixture, Calls) {
    let (factory, calls) = factory_replying(start, reply);
    let fx = fixture_with(fast(), factory);
    fx.launcher.attach_board(&board.shared);
    fx.launcher.start(no_projects);
    fx.launcher
        .launch(&board.id, "Demo", fx.folder.path(), Tool::ClaudeCode, None)
        .unwrap();
    (fx, calls)
}

pub(super) fn sent(calls: &Calls) -> Vec<String> {
    calls
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter_map(|call| match call {
            Call::Send(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

pub(super) fn pause() {
    std::thread::sleep(Duration::from_millis(400));
}

#[test]
fn a_request_is_pushed_to_an_idle_session_once_it_is_taken() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the session to be idle", || fx.launcher.health().waiting);
    let id = board.request("Add a link");
    wait_until("the push", || !sent(&calls).is_empty());
    let text = sent(&calls).remove(0);
    assert!(text.contains("\"kind\":\"requests\""), "{text}");
    assert!(text.contains(&id) && text.contains("Add a link"), "{text}");
    assert!(text.contains("Do not run `agboard wait`"), "{text}");
    // The session takes it, so the board has nothing more to send.
    board.accept(&id);
    pause();
    assert_eq!(sent(&calls).len(), 1);
    fx.launcher.shutdown();
}

#[test]
fn nothing_is_pushed_while_a_turn_runs() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    board.request("Add a link");
    // The first turn lasts a while: the session is busy until then.
    let start = vec![
        Step::Event(DriverEvent::Started {
            session_id: None,
            tool_version: None,
        }),
        Step::Sleep(Duration::from_millis(800)),
        Step::Event(DriverEvent::TurnEnded(TurnOutcome::Completed)),
    ];
    let (fx, calls) = session(&board, start, turn_ends());
    std::thread::sleep(Duration::from_millis(400));
    assert!(!fx.launcher.health().waiting);
    assert!(sent(&calls).is_empty(), "pushed during a turn");
    wait_until("the push after the turn ended", || !sent(&calls).is_empty());
    fx.launcher.shutdown();
}

#[test]
fn a_request_that_is_already_accepted_is_not_pushed() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let id = board.request("Taken elsewhere");
    board.accept(&id);
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the session to be idle", || fx.launcher.health().waiting);
    pause();
    assert!(sent(&calls).is_empty());
    fx.launcher.shutdown();
}

#[test]
fn only_answers_to_questions_the_board_session_asked_are_pushed() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let external = board.ask(None, "Asked by an external session");
    let ours = board.ask(Some("resident-abc"), "Asked by the board session");
    board.answer(&external);
    board.answer(&ours);
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the push", || !sent(&calls).is_empty());
    let text = sent(&calls).remove(0);
    assert!(text.contains("\"kind\":\"answers\""), "{text}");
    assert!(text.contains(&format!("\"id\":\"{ours}\"")), "{text}");
    assert!(!text.contains(&format!("\"id\":\"{external}\"")), "{text}");
    fx.launcher.shutdown();
}

#[test]
fn a_ready_task_is_pushed_but_not_one_that_is_running_or_not_the_agents() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let human = board.task("A person's task", Assignee::Human);
    let busy = board.task("Already running", Assignee::Ai);
    board.run(busy);
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the session to be idle", || fx.launcher.health().waiting);
    pause();
    assert!(sent(&calls).is_empty(), "{:?}", sent(&calls));
    let ready = board.task("Ready to go", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    let text = sent(&calls).remove(0);
    assert!(text.contains("\"kind\":\"task\""), "{text}");
    assert!(text.contains("Ready to go"), "{text}");
    assert!(!text.contains(&format!("\"id\":{human},")), "{text}");
    assert!(!text.contains(&format!("\"id\":{busy},")), "{text}");
    assert!(text.contains(&format!("\"id\":{ready},")), "{text}");
    fx.launcher.shutdown();
}

#[test]
fn an_item_that_keeps_failing_is_pushed_a_few_times_then_listed_as_stalled() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let failing = vec![
        Step::Event(DriverEvent::Started {
            session_id: None,
            tool_version: None,
        }),
        Step::Event(DriverEvent::TurnEnded(TurnOutcome::Failed {
            message: "boom".into(),
        })),
    ];
    let first = board.request("Never handled");
    let (fx, calls) = session(&board, turn_ends(), failing);
    wait_until("three pushes", || sent(&calls).len() == 3);
    wait_until("the stalled note", || {
        !fx.launcher.health().push_stalled.is_empty()
    });
    let note = fx.launcher.health().push_stalled.remove(0);
    assert_eq!(format!("{:?}", note.kind), "Request");
    assert_eq!(note.id, first);
    assert_eq!(note.attempts, 3);
    assert_eq!(note.last_error.as_deref(), Some("boom"));
    // No fourth push, however long it waits.
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(sent(&calls).len(), 3);
    // A new item still goes out: the stalled one does not block the board.
    let second = board.request("Fresh");
    wait_until("the fresh request", || {
        sent(&calls).iter().any(|text| text.contains(&second))
    });
    // Once the item leaves the board, it leaves the note.
    board.accept(&first);
    wait_until("the note to clear", || {
        fx.launcher.health().push_stalled.is_empty()
    });
    fx.launcher.shutdown();
}
