//! Push mode and epic waves: a Todo task waits for the waves before it.

use chrono::Utc;

use super::push::{Board, board, pause, sent, session, turn_ends};
use super::*;
use crate::domain::{Actor, Assignee, ChangeContext, Column};
use crate::file_store::model::NewEpic;
use crate::file_store::validate::EpicId;

impl Board {
    /// An epic that lists `waves`, with each listed task assigned to it.
    fn waves(&self, waves: &[Vec<i64>]) {
        let epic = EpicId::normalize("WAVES").unwrap();
        self.store
            .create_epic(
                &self.id,
                NewEpic {
                    id: "WAVES".into(),
                    name: "Waves".into(),
                    color: None,
                    draft: None,
                    document: None,
                },
                Utc::now(),
            )
            .unwrap();
        for id in waves.iter().flatten() {
            self.store
                .set_task_epic(&self.id, *id, Some(&epic), Actor::Human, Utc::now())
                .unwrap();
        }
        self.store
            .set_epic_waves(&self.id, &epic, waves, false, Utc::now())
            .unwrap();
    }

    fn finish(&self, id: i64) {
        let ctx = ChangeContext {
            actor: Actor::Human,
            reason: "Done".into(),
        };
        self.store
            .move_work_task(&self.id, id, Column::Done, ctx, Utc::now())
            .unwrap();
    }
}

#[test]
fn a_todo_task_of_a_later_wave_is_pushed_only_once_the_earlier_waves_are_done() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let first = board.task("First wave", Assignee::Ai);
    let second = board.task("Second wave", Assignee::Ai);
    board.waves(&[vec![first], vec![second]]);
    board.run(first);
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("the session to be idle", || fx.launcher.health().waiting);
    pause();
    assert!(sent(&calls).is_empty(), "{:?}", sent(&calls));
    board.finish(first);
    wait_until("the push", || !sent(&calls).is_empty());
    let text = sent(&calls).remove(0);
    assert!(text.contains(&format!("\"id\":{second},")), "{text}");
    fx.launcher.shutdown();
}
