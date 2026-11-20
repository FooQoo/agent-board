//! The turn of a Stop hook: what the agent said and did since it was last
//! asked, read from the transcript (Claude Code or Codex).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

/// Largest tail of the transcript that is read, in bytes.
const MAX_TRANSCRIPT_BYTES: u64 = 8 * 1024 * 1024;

/// A tool call the agent made in the turn.
#[derive(Debug, Clone, Default)]
pub struct Call {
    /// The tool name (`Bash`, `Write`, `exec`, ...).
    pub name: String,
    /// The shell command or script text, empty for a call without one.
    pub command: String,
    /// The file a write tool targets, empty for any other call.
    pub path: String,
}

/// What happened in the current turn.
#[derive(Debug, Clone, Default)]
pub struct Turn {
    pub last_text: Option<String>,
    pub calls: Vec<Call>,
}

/// The turn the transcript at `path` ends with. `turn_id` is Codex's active
/// turn. `None` when the transcript cannot be read.
pub fn read_turn(path: &str, turn_id: Option<&str>) -> Option<Turn> {
    let text = read_tail(path)?;
    let entries: Vec<Value> = lines(&text).collect();
    // Codex: after the `task_started` of this turn, else of the last one.
    // Claude Code: after the last real user message.
    let start = entries
        .iter()
        .rposition(|e| is_task_started(e, turn_id))
        .or_else(|| entries.iter().rposition(|e| is_task_started(e, None)))
        .or_else(|| entries.iter().rposition(is_user_message))
        .map_or(0, |i| i + 1);
    let mut calls = Vec::new();
    for entry in &entries[start..] {
        calls_of(entry, &mut calls);
    }
    Some(Turn {
        last_text: last_assistant_text_of(&entries),
        calls,
    })
}

fn read_tail(path: &str) -> Option<String> {
    let mut file = std::fs::File::open(Path::new(path)).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(MAX_TRANSCRIPT_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_TRANSCRIPT_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // A cut first line is not whole JSON: drop it.
    Some(if start > 0 {
        text.split_once('\n').map(|(_, rest)| rest.to_string())?
    } else {
        text
    })
}

fn lines(transcript: &str) -> impl Iterator<Item = Value> + '_ {
    transcript
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
}

/// The text of the last assistant message in a transcript (Claude Code or Codex).
fn last_assistant_text_of(entries: &[Value]) -> Option<String> {
    let mut last = None;
    for entry in entries {
        let text = if entry["type"] == "assistant" && entry["isSidechain"] != true {
            blocks_text(&entry["message"]["content"], "text")
        } else if entry["type"] == "response_item"
            && entry["payload"]["type"] == "message"
            && entry["payload"]["role"] == "assistant"
        {
            blocks_text(&entry["payload"]["content"], "output_text")
        } else {
            None
        };
        if let Some(text) = text.filter(|t| !t.trim().is_empty()) {
            last = Some(text);
        }
    }
    last
}

fn blocks_text(content: &Value, kind: &str) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => {
            let parts: Vec<&str> = blocks
                .iter()
                .filter(|b| b["type"] == kind)
                .filter_map(|b| b["text"].as_str())
                .collect();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        _ => None,
    }
}

/// Whether a real user message starts this entry's turn.
fn is_user_message(entry: &Value) -> bool {
    if entry["type"] == "user" {
        if entry["isSidechain"] == true || entry["isMeta"] == true {
            return false;
        }
        return match &entry["message"]["content"] {
            Value::String(text) => !text.trim().is_empty(),
            Value::Array(blocks) => {
                blocks.iter().any(|b| b["type"] == "text")
                    && !blocks.iter().any(|b| b["type"] == "tool_result")
            }
            _ => false,
        };
    }
    // Codex records injected context as user messages, so a user message is
    // no turn start there: its turns are found by `task_started`.
    false
}

/// Whether the entry is Codex's `task_started` event for `turn_id` (any turn
/// when `turn_id` is `None`).
fn is_task_started(entry: &Value, turn_id: Option<&str>) -> bool {
    entry["type"] == "event_msg"
        && entry["payload"]["type"] == "task_started"
        && turn_id.is_none_or(|id| entry["payload"]["turn_id"] == id)
}

/// The tool calls the entry holds.
fn calls_of(entry: &Value, out: &mut Vec<Call>) {
    if entry["type"] == "assistant" {
        if let Some(blocks) = entry["message"]["content"].as_array() {
            for block in blocks.iter().filter(|b| b["type"] == "tool_use") {
                out.push(Call {
                    name: block["name"].as_str().unwrap_or_default().to_string(),
                    command: block["input"]["command"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    path: block["input"]["file_path"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                });
            }
        }
    } else if entry["type"] == "response_item" {
        let payload = &entry["payload"];
        let name = payload["name"].as_str().unwrap_or_default().to_string();
        let command = match payload["type"].as_str() {
            Some("function_call") | Some("custom_tool_call") => payload["arguments"]
                .as_str()
                .or(payload["input"].as_str())
                .map(str::to_string),
            Some("local_shell_call") => Some(payload["action"]["command"].to_string()),
            _ => None,
        };
        if let Some(command) = command {
            out.push(Call {
                name,
                command,
                path: String::new(),
            });
        }
    }
}
