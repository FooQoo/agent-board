//! Push mode: an item that clean turns leave unchanged is on hold, not failing.

use super::push::{board, sent, session, turn_ends};
use super::*;

#[test]
fn an_item_left_unchanged_by_clean_turns_is_listed_as_on_hold() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let board = board();
    // Every turn ends cleanly, and nothing accepts the request: like a task that waits for a
    // person, it stays on the board.
    let first = board.request("Waits for a person");
    let (fx, calls) = session(&board, turn_ends(), turn_ends());
    wait_until("three pushes", || sent(&calls).len() == 3);
    wait_until("the hold note", || {
        !fx.launcher.health().push_stalled.is_empty()
    });
    let note = fx.launcher.health().push_stalled.remove(0);
    assert_eq!(note.id, first);
    assert_eq!(note.attempts, 3);
    assert_eq!(note.last_error, None);
    assert!(note.on_hold);
    fx.launcher.shutdown();
}
