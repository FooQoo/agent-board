//! What to push now: the pure decision from a board snapshot and the log of earlier pushes.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::super::supervisor::Timing;
use crate::agent::task_wait;
use crate::domain::ProjectId;
use crate::file_store::reader::ProjectSnapshot;
use crate::progress::{ProgressAnswer, ProgressRequest, open_requests, unaccepted_answers};

/// How often a push of one item may be repeated, and how long to wait between two of them.
#[derive(Debug, Clone, Copy)]
pub(in crate::server::resident) struct Policy {
    pub max_attempts: u32,
    pub backoff_base: Duration,
    pub backoff_max: Duration,
}

impl Policy {
    pub(in crate::server::resident) fn of(timing: &Timing) -> Policy {
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

/// What kind of board item was pushed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StalledKind {
    Request,
    Answer,
    Task,
}

/// An item the board pushed several times without the session handling it, and gave up on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stalled {
    pub kind: StalledKind,
    /// The request or question ID such as `Q-3`, or the task number as text.
    pub id: String,
    /// How many times the item was pushed.
    pub attempts: u32,
    /// How the last turn failed, if it did.
    pub last_error: Option<String>,
    /// Whether the turns ended cleanly and the item was left as it was, so it is on hold rather
    /// than failing: typically work that waits for a person. True exactly when `last_error` is
    /// `None`.
    pub on_hold: bool,
}

/// What was pushed and how often, per item key (`answer:Q-3`, `request:Q-5`, `task:12`).
#[derive(Default)]
pub(super) struct Log {
    attempts: HashMap<String, Attempt>,
    /// The items that were given up, as the health lists them.
    pub(super) stalled: Vec<(String, Stalled)>,
    /// How the last turn failed, if it did.
    pub(super) last_failure: Option<String>,
}

/// One instruction for the session: what it is about, the keys of the items in it, and its text.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Instruction {
    pub keys: Vec<String>,
    /// The tasks in it, which the session may start.
    pub tasks: Vec<i64>,
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
            let (kind, id) = key.split_once(':').unwrap_or(("task", key));
            let note = Stalled {
                kind: match kind {
                    "request" => StalledKind::Request,
                    "answer" => StalledKind::Answer,
                    _ => StalledKind::Task,
                },
                id: id.to_string(),
                attempts: attempt.count,
                last_error: self.last_failure.clone(),
                on_hold: self.last_failure.is_none(),
            };
            match self.stalled.iter_mut().find(|(k, _)| k == key) {
                Some(entry) => entry.1 = note,
                None => self.stalled.push((key.to_string(), note)),
            }
            return false;
        }
        now.saturating_duration_since(attempt.last) >= policy.delay(attempt.count)
    }

    pub(super) fn record(&mut self, keys: &[String], now: Instant) {
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
            tasks: Vec::new(),
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
            tasks: Vec::new(),
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
        tasks: vec![task.id],
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
