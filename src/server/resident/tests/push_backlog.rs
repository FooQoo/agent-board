//! Push mode: a Backlog plan is not pushed until a person sends it to Todo.

use chrono::Utc;

use super::push::{board, pause, sent, session, turn_ends};
use super::*;
use crate::domain::{Actor, Assignee, NewTask};

#[test]
fn a_backlog_plan_is_not_pushed_until_a_person_sends_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the session to be idle", || fx.launcher.health().waiting);
    let plan = board
        .store
        .create_task_in_backlog(
            &board.id,
            NewTask {
                title: "A settled plan".into(),
                description: String::new(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
                draft: None,
            },
            Utc::now(),
        )
        .unwrap()
        .id;
    pause();
    assert!(sent(&calls).is_empty(), "{:?}", sent(&calls));
    board
        .store
        .send_task(&board.id, plan, Actor::Human, false, Utc::now())
        .unwrap();
    wait_until("the push after the send", || !sent(&calls).is_empty());
    let text = sent(&calls).remove(0);
    assert!(text.contains("A settled plan"), "{text}");
    fx.launcher.shutdown();
}
