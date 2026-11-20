//! A resident agent that stops on an error leaves a note on the task it was working on.

use super::health::fast;
use super::push::{Board, board, sent, session, turn_ends};
use super::*;
use crate::domain::{Actor, Assignee, ChangeContext, RunState};
use crate::server::resident::driver::mock::Step;
use crate::server::resident::driver::{DriverEvent, TurnOutcome};

fn started() -> Step {
    Step::Event(DriverEvent::Started {
        session_id: None,
        tool_version: None,
    })
}

/// The reply of a session that works for a moment, then ends in `end`.
fn then(end: DriverEvent) -> Vec<Step> {
    after(Duration::from_millis(300), end)
}

fn after(pause: Duration, end: DriverEvent) -> Vec<Step> {
    vec![started(), Step::Sleep(pause), Step::Event(end)]
}

fn failed(message: &str) -> DriverEvent {
    DriverEvent::TurnEnded(TurnOutcome::Failed {
        message: message.into(),
    })
}

fn notes(board: &Board, id: i64) -> Vec<String> {
    let task = board.store.task(&board.id, id).unwrap();
    task.history
        .iter()
        .filter(|entry| entry.reason.contains("stopped on an error"))
        .map(|entry| entry.reason.clone())
        .collect()
}

#[test]
fn a_failed_turn_leaves_one_note_and_returns_the_running_task_to_idle() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(&board, turn_ends(), then(failed("boom")));
    let id = board.task("Handled by the agent", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    // The session starts the task the way an agent does.
    board.run(id);
    wait_until("the note", || !notes(&board, id).is_empty());
    let note = notes(&board, id).remove(0);
    assert!(note.contains("boom"), "{note}");
    assert!(note.contains("Another agent needs to take over"), "{note}");
    let task = board.store.task(&board.id, id).unwrap();
    assert_eq!(task.agent_status, RunState::Idle);
    // The board pushes the task again after the backoff, and each retry fails before the task
    // runs, so no second note is written for the same failure.
    std::thread::sleep(Duration::from_millis(1200));
    assert_eq!(notes(&board, id).len(), 1, "{:?}", notes(&board, id));
    fx.launcher.shutdown();
}

#[test]
fn a_task_the_agent_never_started_gets_no_note() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(&board, turn_ends(), then(failed("boom")));
    let id = board.task("Never started", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    std::thread::sleep(Duration::from_millis(800));
    assert!(notes(&board, id).is_empty());
    fx.launcher.shutdown();
}

#[test]
fn a_turn_that_completes_leaves_no_note() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(
        &board,
        turn_ends(),
        then(DriverEvent::TurnEnded(TurnOutcome::Completed)),
    );
    let id = board.task("Works fine", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    board.run(id);
    std::thread::sleep(Duration::from_millis(800));
    assert!(notes(&board, id).is_empty());
    let task = board.store.task(&board.id, id).unwrap();
    assert_eq!(task.agent_status, RunState::Running);
    fx.launcher.shutdown();
}

#[test]
fn a_session_that_dies_during_a_turn_leaves_a_note() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let exit = DriverEvent::Exited {
        code: Some(1),
        signal: None,
    };
    let (fx, calls) = session(&board, turn_ends(), then(exit));
    let id = board.task("Interrupted by a crash", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    board.run(id);
    wait_until("the note", || !notes(&board, id).is_empty());
    assert!(notes(&board, id)[0].contains("exit status: 1"));
    fx.launcher.shutdown();
}

#[test]
fn a_stop_by_a_person_leaves_no_note() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, calls) = session(
        &board,
        turn_ends(),
        after(Duration::from_millis(3000), failed("late")),
    );
    let id = board.task("Stopped on purpose", Assignee::Ai);
    wait_until("the push", || !sent(&calls).is_empty());
    board.run(id);
    fx.launcher.stop().unwrap();
    std::thread::sleep(Duration::from_millis(3500));
    assert!(notes(&board, id).is_empty(), "{:?}", notes(&board, id));
}

/// A launcher with no child, pointed at a board folder that has no such project, so that saving
/// a note fails. Returns it with the real board to point it at later.
fn failing_launcher() -> (Fixture, Board, tempfile::TempDir) {
    let board = board();
    let (factory, _calls) = driver::mock::factory_replying(Vec::new(), Vec::new());
    let fx = fixture_with(fast(), factory);
    let broken = tempfile::tempdir().unwrap();
    fx.launcher.attach_board(broken.path());
    (fx, board, broken)
}

#[test]
fn a_note_that_could_not_be_saved_is_kept_and_a_clean_turn_end_does_not_release_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let (fx, board, _broken) = failing_launcher();
    let id = board.task("Storage was down", Assignee::Ai);
    board.run(id);
    fx.launcher.hand_over(&board.id, &[id], "boom");
    assert_eq!(fx.launcher.unrecorded.lock().unwrap().len(), 1);
    // A clean end of a child's turn only releases that child's handed tasks.
    let push = crate::server::resident::push::Push::new();
    push.add_handed(&[id]);
    assert!(push.settle(None, true).is_none());
    assert_eq!(fx.launcher.unrecorded.lock().unwrap().len(), 1);
    // Still failing: the entry stays, once.
    fx.launcher.retry_handoffs();
    assert_eq!(fx.launcher.unrecorded.lock().unwrap().len(), 1);
    // Storage works again: the same note, with the original failure, is written once.
    fx.launcher.attach_board(&board.shared);
    fx.launcher.retry_handoffs();
    fx.launcher.retry_handoffs();
    assert!(fx.launcher.unrecorded.lock().unwrap().is_empty());
    let found = notes(&board, id);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("boom"), "{found:?}");
    assert_eq!(
        board.store.task(&board.id, id).unwrap().agent_status,
        RunState::Idle
    );
}

#[test]
fn a_task_that_is_no_longer_running_is_dropped_from_the_retry_list() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let (fx, board, _broken) = failing_launcher();
    let id = board.task("Taken over meanwhile", Assignee::Ai);
    board.run(id);
    fx.launcher.hand_over(&board.id, &[id], "boom");
    board
        .store
        .set_agent_status(
            &board.id,
            id,
            RunState::Idle,
            ChangeContext {
                actor: Actor::Ai,
                reason: "Taken over".into(),
            },
            chrono::Utc::now(),
        )
        .unwrap();
    fx.launcher.attach_board(&board.shared);
    fx.launcher.retry_handoffs();
    assert!(fx.launcher.unrecorded.lock().unwrap().is_empty());
    assert!(notes(&board, id).is_empty());
}

#[test]
fn a_pusher_retries_a_note_that_an_exit_could_not_save() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    let (fx, _calls) = session(&board, turn_ends(), Vec::new());
    let id = board.task("Exit during an outage", Assignee::Ai);
    board.run(id);
    let broken = tempfile::tempdir().unwrap();
    fx.launcher.attach_board(broken.path());
    // The exit path of an earlier child failed to save, and its handed set is gone with it.
    fx.launcher.hand_over(&board.id, &[id], "exit status: 1");
    assert_eq!(fx.launcher.unrecorded.lock().unwrap().len(), 1);
    fx.launcher.attach_board(&board.shared);
    wait_until("the note", || !notes(&board, id).is_empty());
    assert!(notes(&board, id)[0].contains("exit status: 1"));
    fx.launcher.shutdown();
}
