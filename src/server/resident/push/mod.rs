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
}

impl Push {
    pub(super) fn new() -> Push {
        Push {
            woken: Mutex::new(false),
            wake: Condvar::new(),
            log: Mutex::new(Log::default()),
            attached_at: Mutex::new(None),
            closed: Mutex::new(false),
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

    /// A turn ended: remember how, and look at the board.
    pub(super) fn turn_ended(&self, outcome: &TurnOutcome) {
        let mut log = self.log.lock().unwrap_or_else(|e| e.into_inner());
        log.last_failure = match outcome {
            TurnOutcome::Failed { message } => Some(message.clone()),
            TurnOutcome::Completed | TurnOutcome::Interrupted => None,
        };
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
    driver.send_user_message(&instruction.text).is_ok()
}
