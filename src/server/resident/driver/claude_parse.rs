//! Reading the stream-json lines of Claude Code. Only the fields the board needs are read, and
//! a message of a kind this code does not know is an [`DriverEvent::Unknown`], never an error.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::{DriverEvent, PermissionKind, TurnOutcome};

/// What one line of output means.
#[derive(Debug, Default)]
pub(super) struct Parsed {
    pub events: Vec<DriverEvent>,
    /// A line to send back to the CLI at once (an error for a request this code cannot serve).
    pub reply: Option<Value>,
    /// A subagent or background command that started or ended, when the line says so.
    pub task: Option<TaskChange>,
}

/// A change in the work the session waits on: a subagent or a background command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum TaskChange {
    Started {
        id: String,
        description: String,
    },
    Ended {
        id: String,
        /// `completed`, `failed`, or `stopped`.
        status: String,
        description: String,
    },
}

/// The permission requests waiting for an answer, with the input each one carried: an allow
/// answer must hand the input back.
pub(super) type Pending = HashMap<String, Value>;

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn short(text: &str) -> String {
    let line = text.lines().next().unwrap_or("");
    let mut out: String = line.chars().take(200).collect();
    if line.chars().count() > 200 {
        out.push('…');
    }
    out
}

pub(super) fn parse_line(line: &str, pending: &mut Pending) -> Parsed {
    let mut parsed = Parsed::default();
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        parsed.events.push(DriverEvent::Unknown);
        return parsed;
    };
    match text(&message, "type") {
        Some("system") => match text(&message, "subtype") {
            Some("init") => parsed.events.push(DriverEvent::Started {
                session_id: text(&message, "session_id").map(str::to_string),
                tool_version: text(&message, "claude_code_version").map(str::to_string),
            }),
            other => {
                parsed.task = task_change(other, &message);
                parsed.events.push(DriverEvent::Activity {
                    kind: format!("system/{}", other.unwrap_or("")),
                    summary: String::new(),
                });
            }
        },
        Some("assistant") => {
            let blocks = message
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in &blocks {
                match text(block, "type") {
                    Some("text") => parsed.events.push(DriverEvent::Activity {
                        kind: "text".to_string(),
                        summary: short(text(block, "text").unwrap_or("")),
                    }),
                    Some("tool_use") => parsed.events.push(DriverEvent::Activity {
                        kind: "tool_use".to_string(),
                        summary: describe(text(block, "name"), block.get("input")),
                    }),
                    _ => {}
                }
            }
        }
        Some("result") => parsed
            .events
            .push(DriverEvent::TurnEnded(outcome(&message))),
        Some("control_request") => control_request(&message, pending, &mut parsed),
        Some("control_cancel_request") => {
            if let Some(id) = text(&message, "request_id") {
                pending.remove(id);
            }
        }
        // Known and not needed: tool results, answers to our requests, limits, partial output.
        Some("user" | "control_response" | "rate_limit_event" | "stream_event") => {}
        _ => parsed.events.push(DriverEvent::Unknown),
    }
    parsed
}

/// The task events of Claude Code: `task_started` when a subagent or a background command
/// begins, `task_notification` (or a `task_updated` with a final status) when it ends.
fn task_change(subtype: Option<&str>, message: &Value) -> Option<TaskChange> {
    let id = text(message, "task_id")?.to_string();
    let description = text(message, "description")
        .or_else(|| text(message, "summary"))
        .map(short)
        .unwrap_or_default();
    let ended = |status: &str| {
        matches!(status, "completed" | "failed" | "stopped" | "killed").then(|| TaskChange::Ended {
            id: id.clone(),
            status: status.to_string(),
            description: description.clone(),
        })
    };
    match subtype? {
        "task_started" => Some(TaskChange::Started { id, description }),
        "task_notification" => ended(text(message, "status").unwrap_or("completed")),
        "task_updated" => ended(message.pointer("/patch/status").and_then(Value::as_str)?),
        _ => None,
    }
}

fn outcome(message: &Value) -> TurnOutcome {
    let subtype = text(message, "subtype").unwrap_or("");
    if subtype.contains("interrupt")
        || text(message, "terminal_reason") == Some("aborted_streaming")
    {
        return TurnOutcome::Interrupted;
    }
    if message.get("is_error").and_then(Value::as_bool) == Some(true)
        || subtype.starts_with("error")
    {
        let detail = text(message, "result").unwrap_or(subtype);
        return TurnOutcome::Failed {
            message: short(detail),
        };
    }
    TurnOutcome::Completed
}

fn control_request(message: &Value, pending: &mut Pending, parsed: &mut Parsed) {
    let id = text(message, "request_id").unwrap_or("").to_string();
    let request = message.get("request").cloned().unwrap_or(Value::Null);
    if text(&request, "subtype") == Some("can_use_tool") && !id.is_empty() {
        let tool = text(&request, "tool_name");
        let input = request.get("input").cloned().unwrap_or_else(|| json!({}));
        let kind = match tool {
            Some("Bash") => PermissionKind::Command,
            Some("Write" | "Edit" | "MultiEdit" | "NotebookEdit") => PermissionKind::FileChange,
            _ => PermissionKind::Other,
        };
        let summary = describe(tool, Some(&input));
        pending.insert(id.clone(), input);
        parsed
            .events
            .push(DriverEvent::PermissionRequest { id, kind, summary });
        return;
    }
    parsed.events.push(DriverEvent::Unknown);
    if !id.is_empty() {
        parsed.reply = Some(json!({"type": "control_response", "response": {
            "subtype": "error",
            "request_id": id,
            "error": "Agent Board does not handle this request.",
        }}));
    }
}

/// `Bash: <command>`, `Write: <path>`, or the tool name alone.
fn describe(tool: Option<&str>, input: Option<&Value>) -> String {
    let name = tool.unwrap_or("tool");
    let detail = input.and_then(|input| {
        ["command", "file_path", "path", "pattern", "url"]
            .iter()
            .find_map(|key| text(input, key))
    });
    match detail {
        Some(detail) => format!("{name}: {}", short(detail)),
        None => name.to_string(),
    }
}

/// The `control_response` line that answers a `can_use_tool` request.
pub(super) fn permission_response(id: &str, behavior: Value) -> Value {
    json!({"type": "control_response", "response": {
        "subtype": "success",
        "request_id": id,
        "response": behavior,
    }})
}
