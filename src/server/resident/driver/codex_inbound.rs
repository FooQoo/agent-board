//! What comes in from the server: answers to our requests, requests of its own, and the
//! notifications it sends unasked. Part of [`Session`].

use serde_json::{Value, json};

use super::codex_parse::{Session, Step, Waiting, short, text, thread_params, version_of};
use super::{DriverEvent, PermissionKind, TurnOutcome};

impl Session {
    pub(super) fn response(&mut self, id: &Value, message: &Value, step: &mut Step) {
        let Some(waiting) = id.as_u64().and_then(|id| self.waiting.remove(&id)) else {
            step.events.push(DriverEvent::Unknown);
            return;
        };
        let error = message
            .pointer("/error/message")
            .and_then(Value::as_str)
            .map(short);
        let result = message.get("result").cloned().unwrap_or(Value::Null);
        match (waiting, error) {
            (Waiting::Initialize, None) => {
                step.sends.push(json!({"method": "initialized"}));
                let params = thread_params(&self.settings);
                let line = self.request("thread/start", params, Waiting::ThreadStart);
                step.sends.push(line);
                let agent = text(&result, "userAgent").unwrap_or("");
                self.tool_version = agent.split_whitespace().next().and_then(version_of);
            }
            (Waiting::ThreadStart, None) => {
                let thread = result.pointer("/thread/id").and_then(Value::as_str);
                let Some(thread) = thread else {
                    step.notes
                        .push("thread/start returned no thread".to_string());
                    step.close = true;
                    return;
                };
                self.thread = Some(thread.to_string());
                // The first prompt is queued: no turn is on the way yet.
                self.in_flight = false;
                step.events.push(DriverEvent::Started {
                    session_id: Some(thread.to_string()),
                    tool_version: self.tool_version.clone(),
                });
                self.start_turn(step);
            }
            (Waiting::TurnStart, None) => {
                if let Some(turn) = result.pointer("/turn/id").and_then(Value::as_str)
                    && self.in_flight
                {
                    self.turn.get_or_insert_with(|| turn.to_string());
                }
            }
            (Waiting::Steer(_) | Waiting::Other, None) => {}
            (Waiting::Initialize | Waiting::ThreadStart, Some(error)) => {
                step.notes
                    .push(format!("the session could not be set up: {error}"));
                step.close = true;
            }
            (Waiting::TurnStart, Some(error)) => {
                self.in_flight = false;
                self.turn = None;
                step.busy = Some(false);
                step.events
                    .push(DriverEvent::TurnEnded(TurnOutcome::Failed {
                        message: error,
                    }));
            }
            (Waiting::Steer(message), Some(error)) => {
                // Not accepted into the running turn: it starts a turn of its own after this one.
                step.notes.push(format!("turn/steer was refused: {error}"));
                self.queue.push(message);
                if !self.in_flight {
                    self.start_turn(step);
                }
            }
            (Waiting::Other, Some(error)) => step.notes.push(format!("a request failed: {error}")),
        }
    }

    pub(super) fn server_request(
        &mut self,
        method: &str,
        id: &Value,
        message: &Value,
        step: &mut Step,
    ) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let kind = match method {
            "item/commandExecution/requestApproval" => Some(PermissionKind::Command),
            "item/fileChange/requestApproval" => Some(PermissionKind::FileChange),
            _ => None,
        };
        let Some(kind) = kind else {
            step.events.push(DriverEvent::Unknown);
            step.sends.push(json!({"id": id, "error": {
                "code": -32601,
                "message": "Agent Board does not handle this request.",
            }}));
            return;
        };
        let summary = self.describe(kind, &params);
        let ours = format!("codex-{}", id.to_string().trim_matches('"'));
        self.approvals.insert(ours.clone(), id.clone());
        step.events.push(DriverEvent::PermissionRequest {
            id: ours,
            kind,
            summary,
        });
    }

    pub(super) fn describe(&self, kind: PermissionKind, params: &Value) -> String {
        let item = text(params, "itemId").and_then(|id| self.items.get(id));
        match kind {
            PermissionKind::Command => {
                let command = text(params, "command")
                    .or_else(|| item.and_then(|item| text(item, "command")))
                    .unwrap_or("");
                format!("command: {}", short(command))
            }
            _ => {
                let path = item
                    .and_then(|item| item.get("changes"))
                    .and_then(Value::as_array)
                    .and_then(|changes| changes.first())
                    .and_then(|change| text(change, "path"));
                match path {
                    Some(path) => format!("file change: {}", short(path)),
                    None => "file change".to_string(),
                }
            }
        }
    }

    pub(super) fn notification(&mut self, method: &str, message: &Value, step: &mut Step) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        match method {
            "turn/started" => {
                if let Some(turn) = params.pointer("/turn/id").and_then(Value::as_str) {
                    self.turn = Some(turn.to_string());
                }
                self.in_flight = true;
                step.busy = Some(true);
            }
            "turn/completed" => {
                let turn = params.get("turn").cloned().unwrap_or(Value::Null);
                self.turn = None;
                self.in_flight = false;
                self.items.clear();
                step.busy = Some(false);
                step.events.push(DriverEvent::TurnEnded(outcome(&turn)));
                // A message that waited for the turn to end starts the next one.
                self.start_turn(step);
            }
            "item/started" | "item/completed" => {
                if let Some(item) = params.get("item") {
                    self.item(method == "item/started", item, step);
                }
            }
            "error" => step.events.push(DriverEvent::Activity {
                kind: "error".to_string(),
                summary: short(
                    params
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ),
            }),
            // Known and not needed: status, deltas, tokens, hooks, servers, accounts, warnings.
            "warning" | "configWarning" | "deprecationNotice" => {}
            other if is_noise(other) => {}
            _ => step.events.push(DriverEvent::Unknown),
        }
    }

    fn item(&mut self, started: bool, item: &Value, step: &mut Step) {
        let Some(kind) = text(item, "type") else {
            return;
        };
        if started && let Some(id) = text(item, "id") {
            self.items.insert(id.to_string(), item.clone());
        }
        let summary = match (kind, started) {
            ("agentMessage", false) => Some(("text", short(text(item, "text").unwrap_or("")))),
            ("commandExecution", true) => Some((
                "command",
                format!("command: {}", short(text(item, "command").unwrap_or(""))),
            )),
            ("fileChange", true) => Some((
                "file_change",
                self.describe(
                    PermissionKind::FileChange,
                    &json!({"itemId": text(item, "id")}),
                ),
            )),
            _ => None,
        };
        if let Some((kind, summary)) = summary {
            step.events.push(DriverEvent::Activity {
                kind: kind.to_string(),
                summary,
            });
        }
    }
}

fn is_noise(method: &str) -> bool {
    [
        "hook/",
        "remoteControl/",
        "mcpServer/",
        "account/",
        "item/",
        "turn/",
        "thread/",
        "command/",
        "fs/",
        "app/",
        "skills/",
    ]
    .iter()
    .any(|prefix| method.starts_with(prefix))
}

fn outcome(turn: &Value) -> TurnOutcome {
    match text(turn, "status") {
        Some("interrupted") => TurnOutcome::Interrupted,
        Some("failed") => TurnOutcome::Failed {
            message: short(
                turn.pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("The turn failed."),
            ),
        },
        _ => TurnOutcome::Completed,
    }
}
