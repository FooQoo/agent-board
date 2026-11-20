//! Push mode: the server, not the session, watches the board. A board-launched session does not
//! run `agboard wait`. When it is idle between two turns and the board has something for it, the
//! pusher sends one instruction through [`AgentDriver::send_user_message`] and waits for the
//! turn to end before it looks again.
//!
//! What is pushed, in the order `wait --until task` returns it:
//!
//! 1. answers to questions a board-launched session asked (`askedBy` on the question). Answers
//!    to the questions of an external session are left to that session's own wait.
//! 2. open requests. A request is read from the board right before it is sent, so one that a
//!    session of another origin has already accepted is not sent.
//! 3. the next ready task, which is Idle and so not being worked on by anyone.
//!
//! An item that is still on the board after the turn that was given it is pushed again only after
//! a backoff, and at most [`Timing::push_max_attempts`] times in total, so a turn that keeps
//! failing cannot loop. An item that gave up is listed in the health of the session.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

mod decide;

pub(super) use self::decide::Policy;
pub use self::decide::Stalled;
use self::decide::{Log, decide};
use super::driver::{AgentDriver, TurnOutcome};
use crate::domain::ProjectId;
use crate::file_store::FileStore;

/// The state of one board-launched child that the pusher and the event pump share.
pub(super) struct Push {
    woken: Mutex<bool>,
    wake: Condvar,
    log: Mutex<Log>,
    attached_at: Mutex<Option<DateTime<Utc>>>,
    closed: Mutex<bool>,
    /// The tasks given to the session whose turn the board has not seen end cleanly. Turn ends
    /// cannot be matched to sends (Claude Code also ends turns nobody sent, for example when a
    /// background command finishes), so this is a set, not a queue: see [`Push::settle`].
    handed: Mutex<Vec<i64>>,
    /// The message of a failed turn end seen while another turn ran, kept until [`Push::settle`]
    /// can hand the tasks over with it.
    failure: Mutex<Option<String>>,
}

impl Push {
    pub(super) fn new() -> Push {
        Push {
            woken: Mutex::new(false),
            wake: Condvar::new(),
            log: Mutex::new(Log::default()),
            attached_at: Mutex::new(None),
            closed: Mutex::new(false),
            handed: Mutex::new(Vec::new()),
            failure: Mutex::new(None),
        }
    }

    /// Ask the pusher to look at the board now.
    pub(super) fn nudge(&self) {
        *self.woken.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.wake.notify_all();
    }

    /// The child is gone: the pusher ends.
    pub(super) fn close(&self) {
        *self.closed.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.nudge();
    }

    pub(super) fn is_closed(&self) -> bool {
        *self.closed.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Sleep until nudged, or for `poll`, whichever comes first.
    pub(super) fn sleep(&self, poll: Duration) {
        let woken = self.woken.lock().unwrap_or_else(|e| e.into_inner());
        let (mut woken, _) = self
            .wake
            .wait_timeout_while(woken, poll, |woken| !*woken)
            .unwrap_or_else(|e| e.into_inner());
        *woken = false;
    }

    /// The first sign of life of the child: it has started and it speaks.
    pub(super) fn attach(&self, at: DateTime<Utc>) {
        self.attached_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert(at);
    }

    pub(super) fn attached_at(&self) -> Option<DateTime<Utc>> {
        *self.attached_at.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Remember tasks that were just handed to the session.
    pub(super) fn add_handed(&self, tasks: &[i64]) {
        let mut handed = self.handed.lock().unwrap_or_else(|e| e.into_inner());
        for id in tasks {
            if !handed.contains(id) {
                handed.push(*id);
            }
        }
    }

    /// Forget tasks (a send that failed).
    pub(super) fn unhand(&self, tasks: &[i64]) {
        self.handed
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|id| !tasks.contains(id));
    }

    /// Take the tasks of every unhandled turn (the child is gone).
    pub(super) fn take_all_handed(&self) -> Vec<i64> {
        std::mem::take(&mut *self.handed.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// Take the failure kept from a turn end seen while busy (the child is gone), so that the
    /// exit's note carries the original message instead of the exit reason.
    pub(super) fn take_failure(&self) -> Option<String> {
        self.failure
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
    }

    /// A turn ended; `failure` is its message when it failed. Returns the tasks to hand over and
    /// the failure detail for their note: the handed ones, when a failure is known and the
    /// session is idle. Only an idle session is sure to work on nothing, so a turn end seen while
    /// another turn runs (an autonomous end, or one the next push raced ahead of) takes and drops
    /// nothing. A failure seen then is kept (the first one wins) until the session is idle, even
    /// if that end is a clean one. An idle session that ended a turn cleanly with no failure
    /// pending has finished what it was given, so those tasks are released without a note.
    pub(super) fn settle(&self, failure: Option<&str>, idle: bool) -> Option<(Vec<i64>, String)> {
        let mut pending = self.failure.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(message) = failure {
            pending.get_or_insert_with(|| message.to_string());
        }
        if !idle {
            return None;
        }
        let handed = self.take_all_handed();
        pending.take().map(|detail| (handed, detail))
    }

    /// A turn ended: remember how, and look at the board.
    pub(super) fn turn_ended(&self, outcome: &TurnOutcome) {
        let mut log = self.log.lock().unwrap_or_else(|e| e.into_inner());
        log.turn_ended(match outcome {
            TurnOutcome::Failed { message } => Some(message.as_str()),
            TurnOutcome::Completed | TurnOutcome::Interrupted => None,
        });
        drop(log);
        self.nudge();
    }

    /// The items the pusher gave up, each with a reason, in the order they were given up.
    pub(super) fn stalled(&self) -> Vec<Stalled> {
        self.log
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stalled
            .iter()
            .map(|(_, note)| note.clone())
            .collect()
    }
}

/// Look at the board once and push what is due. Returns whether something was sent.
pub(super) fn push_once(
    shared: &std::path::Path,
    project: &ProjectId,
    project_name: &str,
    driver: &dyn AgentDriver,
    push: &Push,
    policy: &Policy,
) -> bool {
    // Never while a turn runs: the board waits for the end of the turn.
    if !driver.is_idle() {
        return false;
    }
    let Ok(snapshot) = FileStore::open(shared).board(project) else {
        return false;
    };
    if !snapshot.problems.is_empty() {
        return false;
    }
    let now = Instant::now();
    let instruction = {
        let mut log = push.log.lock().unwrap_or_else(|e| e.into_inner());
        decide(
            shared,
            &snapshot,
            project,
            project_name,
            &mut log,
            policy,
            now,
        )
    };
    let Some(instruction) = instruction else {
        return false;
    };
    // The book is kept before the send, so a send that fails still counts as an attempt.
    push.log
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .record(&instruction.keys, now);
    // Set before the send: a turn can end before the send returns.
    push.add_handed(&instruction.tasks);
    let sent = driver.send_user_message(&instruction.text).is_ok();
    if !sent {
        push.unhand(&instruction.tasks);
    }
    sent
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_end_while_another_turn_runs_neither_takes_nor_drops_the_tasks() {
        let push = Push::new();
        push.add_handed(&[1]);
        // An autonomous failed end while the session works on task 1's turn.
        assert!(push.settle(Some("boom"), false).is_none());
        assert!(push.settle(None, false).is_none());
        // The turn really fails once the session is idle.
        assert_eq!(
            push.settle(Some("boom"), true),
            Some((vec![1], "boom".into()))
        );
        assert!(
            push.settle(Some("boom"), true)
                .is_none_or(|(t, _)| t.is_empty())
        );
    }

    #[test]
    fn a_failure_seen_while_busy_is_applied_at_the_next_clean_idle_end() {
        let push = Push::new();
        push.add_handed(&[1]);
        assert!(push.settle(Some("first"), false).is_none());
        assert!(push.settle(Some("second"), false).is_none());
        assert_eq!(push.settle(None, true), Some((vec![1], "first".into())));
        push.add_handed(&[2]);
        assert!(push.settle(None, true).is_none());
    }

    #[test]
    fn an_exit_takes_the_failure_seen_while_busy() {
        let push = Push::new();
        push.add_handed(&[1]);
        assert!(push.settle(Some("first"), false).is_none());
        assert_eq!(push.take_failure().as_deref(), Some("first"));
        assert_eq!(push.take_all_handed(), vec![1]);
        assert!(push.take_failure().is_none());
    }

    #[test]
    fn a_clean_end_of_an_idle_session_releases_the_tasks_without_a_note() {
        let push = Push::new();
        push.add_handed(&[1, 2]);
        assert!(push.settle(None, true).is_none());
        assert!(push.take_all_handed().is_empty());
    }

    #[test]
    fn an_exit_takes_every_handed_task_once() {
        let push = Push::new();
        push.add_handed(&[1]);
        push.add_handed(&[1, 2, 3]);
        assert_eq!(push.take_all_handed(), vec![1, 2, 3]);
        assert!(push.take_all_handed().is_empty());
    }
}
