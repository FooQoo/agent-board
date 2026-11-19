//! The JSON-RPC conversation with `codex app-server`, as a state machine without a process.
//! Lines of output go in; the events, the lines to send back, and a few effects come out. Only
//! the fields the board needs are read, and a message this code does not know is an
//! [`DriverEvent::Unknown`], never an error.
//!
//! The wire is one JSON object per line with no `jsonrpc` field. Ids of the requests this side
//! sends are counted here and kept apart from the ids of the requests the server sends.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{Value, json};

use super::{DriverEvent, PermissionAnswer};

/// What the board asks of the thread it starts.
pub(super) struct Settings {
    pub cwd: PathBuf,
    pub model: Option<String>,
    pub writable_dirs: Vec<PathBuf>,
    pub version: String,
}

/// What came of one step: events for the launcher, lines for the CLI, and effects on the driver.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Step {
    pub events: Vec<DriverEvent>,
    pub sends: Vec<Value>,
    pub notes: Vec<String>,
    /// The session cannot go on: close the input so that the CLI ends.
    pub close: bool,
    /// The new busy state, when the step changed it.
    pub busy: Option<bool>,
}

/// An answer this side waits for, by the id of the request.
pub(super) enum Waiting {
    Initialize,
    ThreadStart,
    TurnStart,
    /// The text goes to the queue if the server refuses it.
    Steer(String),
    Other,
}

pub(super) struct Session {
    pub(super) settings: Settings,
    pub(super) tool_version: Option<String>,
    next_id: u64,
    pub(super) waiting: HashMap<u64, Waiting>,
    pub(super) thread: Option<String>,
    pub(super) turn: Option<String>,
    /// A `turn/start` was sent, or a turn runs, and `turn/completed` has not come.
    pub(super) in_flight: bool,
    pub(super) queue: Vec<String>,
    /// The items seen so far, by id: a file change shows its path only in `item/started`.
    pub(super) items: HashMap<String, Value>,
    /// Approval requests waiting for an answer: our id for it, and the server's id.
    pub(super) approvals: HashMap<String, Value>,
}

pub(super) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

pub(super) fn short(text: &str) -> String {
    let line = text.lines().next().unwrap_or("");
    let mut out: String = line.chars().take(200).collect();
    if line.chars().count() > 200 {
        out.push('…');
    }
    out
}

/// The `thread/start` parameters: the workspace-write sandbox with automatic review of what it
/// asks, plus the data area as writable. `model` only when one was chosen.
pub(super) fn thread_params(settings: &Settings) -> Value {
    let mut params = json!({
        "cwd": settings.cwd,
        "approvalPolicy": "on-request",
        "approvalsReviewer": "auto_review",
        "sandbox": "workspace-write",
        "config": {"sandbox_workspace_write": {"writable_roots": settings.writable_dirs}},
    });
    if let Some(model) = &settings.model {
        params["model"] = json!(model);
    }
    params
}

pub(super) fn input(message: &str) -> Value {
    json!([{"type": "text", "text": message, "text_elements": []}])
}

impl Session {
    pub(super) fn new(settings: Settings, first_prompt: &str) -> Session {
        Session {
            settings,
            tool_version: None,
            next_id: 0,
            waiting: HashMap::new(),
            thread: None,
            turn: None,
            in_flight: true,
            queue: vec![first_prompt.to_string()],
            items: HashMap::new(),
            approvals: HashMap::new(),
        }
    }

    pub(super) fn request(&mut self, method: &str, params: Value, waiting: Waiting) -> Value {
        self.next_id += 1;
        self.waiting.insert(self.next_id, waiting);
        json!({"id": self.next_id, "method": method, "params": params})
    }

    /// The first line of a session.
    pub(super) fn hello(&mut self) -> Value {
        let params = json!({
            "clientInfo": {"name": "agboard", "title": "Agent Board", "version": self.settings.version},
            "capabilities": {"experimentalApi": false},
        });
        self.request("initialize", params, Waiting::Initialize)
    }

    /// Start a turn with everything queued, when a thread exists and no turn is on the way.
    pub(super) fn start_turn(&mut self, step: &mut Step) {
        let Some(thread) = self.thread.clone() else {
            return;
        };
        if self.in_flight || self.queue.is_empty() {
            return;
        }
        let message = self.queue.join("\n\n");
        self.queue.clear();
        self.in_flight = true;
        step.busy = Some(true);
        let line = self.request(
            "turn/start",
            json!({"threadId": thread, "input": input(&message)}),
            Waiting::TurnStart,
        );
        step.sends.push(line);
    }

    /// A message from the board, at any time: a new turn when idle, a steer while a turn runs.
    pub(super) fn user_message(&mut self, message: &str) -> Step {
        let mut step = Step::default();
        match (&self.thread, &self.turn) {
            (Some(thread), Some(turn)) if self.in_flight => {
                let params = json!({
                    "threadId": thread,
                    "expectedTurnId": turn,
                    "input": input(message),
                });
                let line = self.request("turn/steer", params, Waiting::Steer(message.to_string()));
                step.sends.push(line);
            }
            _ => {
                self.queue.push(message.to_string());
                if !self.in_flight {
                    self.start_turn(&mut step);
                }
            }
        }
        step
    }

    pub(super) fn interrupt(&mut self) -> Step {
        let mut step = Step::default();
        if let (Some(thread), Some(turn)) = (self.thread.clone(), self.turn.clone()) {
            let line = self.request(
                "turn/interrupt",
                json!({"threadId": thread, "turnId": turn}),
                Waiting::Other,
            );
            step.sends.push(line);
        }
        step
    }

    /// The reply to an approval request, or `None` when none waits under `id`.
    pub(super) fn answer(&mut self, id: &str, answer: &PermissionAnswer) -> Option<Value> {
        let rpc_id = self.approvals.remove(id)?;
        // The server has no field for a reason, so a denial loses it.
        let decision = match answer {
            PermissionAnswer::Allow => "accept",
            PermissionAnswer::Deny { .. } => "decline",
        };
        Some(json!({"id": rpc_id, "result": {"decision": decision}}))
    }

    pub(super) fn on_line(&mut self, line: &str) -> Step {
        let mut step = Step::default();
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            step.events.push(DriverEvent::Unknown);
            return step;
        };
        let id = message.get("id").filter(|id| !id.is_null());
        match (text(&message, "method"), id) {
            (Some(method), Some(id)) => self.server_request(method, id, &message, &mut step),
            (Some(method), None) => self.notification(method, &message, &mut step),
            (None, Some(id))
                if message.get("result").is_some() || message.get("error").is_some() =>
            {
                self.response(id, &message, &mut step)
            }
            _ => step.events.push(DriverEvent::Unknown),
        }
        step
    }
}

/// `0.170.0` from `agboard/0.170.0`, the first word of the server's `userAgent`.
pub(super) fn version_of(agent: &str) -> Option<String> {
    let version = agent.rsplit('/').next().unwrap_or("");
    (!version.is_empty()).then(|| version.to_string())
}
