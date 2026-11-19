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

use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

use super::driver::{AgentDriver, TurnOutcome};
use super::supervisor::Timing;
use crate::agent::task_wait;
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::file_store::reader::ProjectSnapshot;
use crate::progress::{ProgressAnswer, ProgressRequest, open_requests, unaccepted_answers};

/// How often a push of one item may be repeated, and how long to wait between two of them.
#[derive(Debug, Clone, Copy)]
pub(super) struct Policy {
    pub max_attempts: u32,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
}

impl Policy {
    pub(super) fn of(timing: &Timing) -> Policy {
        Policy {
            max_attempts: timing.push_max_attempts,
            backoff_base: timing.push_backoff_base,
            backoff_max: timing.push_backoff_max,
        }
    }

    /// The wait before push number `attempts + 1` of an item that was pushed `attempts` times.
    fn delay(&self, attempts: u32) -> Duration {
        let factor = 1u32 << attempts.saturating_sub(1).min(16);
        (self.backoff_base * factor).min(self.backoff_max)
    }
}

struct Attempt {
    count: u32,
    last: Instant,
}

/// What was pushed and how often, per item key (`answer:Q-3`, `request:Q-5`, `task:12`).
#[derive(Default)]
pub(super) struct Log {
    attempts: HashMap<String, Attempt>,
    /// The items that were given up, as the health lists them.
    stalled: Vec<(String, String)>,
    /// How the last turn failed, if it did.
    last_failure: Option<String>,
}

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
    pub(super) fn stalled(&self) -> Vec<String> {
        self.log
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stalled
            .iter()
            .map(|(_, note)| note.clone())
            .collect()
    }
}

/// One instruction for the session: what it is about, the keys of the items in it, and its text.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Instruction {
    pub keys: Vec<String>,
    pub text: String,
}

fn answer_key(id: &str) -> String {
    format!("answer:{id}")
}

fn request_key(id: &str) -> String {
    format!("request:{id}")
}

fn task_key(id: i64) -> String {
    format!("task:{id}")
}

/// Answers to questions that a board-launched session asked. At most one such session lives at
/// a time, so a question with `askedBy` was asked by this session or by an earlier run of it,
/// and either way this is the session to tell.
fn answers_for_board(snapshot: &ProjectSnapshot) -> Vec<ProgressAnswer> {
    let board_asked = |id: &str| {
        snapshot
            .questions
            .iter()
            .any(|question| question.id == id && question.asked_by.is_some())
    };
    unaccepted_answers(snapshot)
        .into_iter()
        .filter(|answer| board_asked(&answer.id))
        .collect()
}

impl Log {
    /// Whether `key` may be pushed now. A key that used up its attempts is recorded as stalled.
    fn eligible(&mut self, key: &str, policy: &Policy, now: Instant) -> bool {
        let Some(attempt) = self.attempts.get(key) else {
            return true;
        };
        if attempt.count >= policy.max_attempts {
            let note = format!(
                "{} was pushed {} times and is still not handled{}.",
                key.replacen(':', " ", 1),
                attempt.count,
                self.last_failure
                    .as_ref()
                    .map(|why| format!(" (the last turn failed: {why})"))
                    .unwrap_or_default()
            );
            match self.stalled.iter_mut().find(|(k, _)| k == key) {
                Some(entry) => entry.1 = note,
                None => self.stalled.push((key.to_string(), note)),
            }
            return false;
        }
        now.saturating_duration_since(attempt.last) >= policy.delay(attempt.count)
    }

    fn record(&mut self, keys: &[String], now: Instant) {
        for key in keys {
            let attempt = self.attempts.entry(key.clone()).or_insert(Attempt {
                count: 0,
                last: now,
            });
            attempt.count += 1;
            attempt.last = now;
        }
    }

    /// Forget the items that are no longer on the board.
    fn retain_present(&mut self, present: &[String]) {
        self.attempts.retain(|key, _| present.contains(key));
        self.stalled.retain(|(key, _)| present.contains(key));
    }
}

/// What to push now, from the board as it is, or nothing. Pure apart from the log.
pub(super) fn decide(
    shared: &std::path::Path,
    snapshot: &ProjectSnapshot,
    project: &ProjectId,
    project_name: &str,
    log: &mut Log,
    policy: &Policy,
    now: Instant,
) -> Option<Instruction> {
    let answers = answers_for_board(snapshot);
    let requests = open_requests(snapshot);
    let tasks = task_wait::ready_tasks(snapshot);
    let mut present: Vec<String> = answers.iter().map(|a| answer_key(&a.id)).collect();
    present.extend(requests.iter().map(|r| request_key(&r.id)));
    present.extend(tasks.iter().map(|t| task_key(t.id)));
    log.retain_present(&present);

    let answers: Vec<ProgressAnswer> = answers
        .into_iter()
        .filter(|a| log.eligible(&answer_key(&a.id), policy, now))
        .collect();
    if !answers.is_empty() {
        let keys = answers.iter().map(|a| answer_key(&a.id)).collect();
        return Some(Instruction {
            keys,
            text: wording(
                project_name,
                &serde_json::json!({
                    "kind": "answers",
                    "projectId": project,
                    "cursor": snapshot.cursor,
                    "answers": answers,
                }),
            ),
        });
    }
    let requests: Vec<ProgressRequest> = requests
        .into_iter()
        .filter(|r| log.eligible(&request_key(&r.id), policy, now))
        .collect();
    if !requests.is_empty() {
        let keys = requests.iter().map(|r| request_key(&r.id)).collect();
        return Some(Instruction {
            keys,
            text: wording(
                project_name,
                &serde_json::json!({
                    "kind": "requests",
                    "projectId": project,
                    "cursor": snapshot.cursor,
                    "requests": requests,
                }),
            ),
        });
    }
    let task = tasks
        .into_iter()
        .find(|t| log.eligible(&task_key(t.id), policy, now))?;
    let rendered = task_wait::render_task(shared, snapshot, project, task).ok()?;
    Some(Instruction {
        keys: vec![task_key(task.id)],
        text: wording(
            project_name,
            &serde_json::from_str::<serde_json::Value>(&rendered).ok()?,
        ),
    })
}

fn wording(project_name: &str, work: &serde_json::Value) -> String {
    format!(
        "Agent Board has work for you in project \"{project_name}\". Handle it as `agboard skills \
         resident` describes under \"Work the board pushes\", then end your turn. Do not run \
         `agboard wait`.\n\n{work}"
    )
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
