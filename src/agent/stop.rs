//! The Stop hook: blocks a turn once when the agent's last words are a question
//! to the user that was not put on the board with `message ask`.
//!
//! Every failure means "do nothing": this hook must never fail a turn.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

/// Largest tail of the transcript that is read, in bytes.
const MAX_TRANSCRIPT_BYTES: u64 = 8 * 1024 * 1024;

const REASON: &str = "Your reply ends with a question for the user, but it is not on the Agent Board. If the question waits on the user's answer, put it on the board now with `agboard --project \"<name>\" message ask --actor ai ...` (and show it in the chat as plain text too, as the agent-board skill says). If nothing waits on the user, end your turn again without a question.";

/// The hook's output when the turn should be blocked, from the fields of the
/// Stop input. `None` means let the turn end.
pub(crate) fn decide(
    stop_hook_active: bool,
    last_assistant_message: Option<&str>,
    transcript_path: Option<&str>,
    turn_id: Option<&str>,
) -> Option<String> {
    if stop_hook_active {
        return None;
    }
    let from_transcript;
    let message = match last_assistant_message {
        Some(text) if !text.trim().is_empty() => text,
        _ => {
            from_transcript = last_assistant_text(&read_tail(transcript_path?)?)?;
            &from_transcript
        }
    };
    if !ends_with_question(message) {
        return None;
    }
    // Without a readable transcript the turn cannot be checked: do nothing.
    let transcript = read_tail(transcript_path?)?;
    if turn_asked_on_board(&transcript, turn_id) {
        return None;
    }
    Some(serde_json::json!({"decision": "block", "reason": REASON}).to_string())
}

/// Whether the last non-empty line of `text` ends with a question mark, once
/// closing markup and quotes are ignored.
pub(crate) fn ends_with_question(text: &str) -> bool {
    let Some(line) = text.lines().rev().map(str::trim).find(|l| !l.is_empty()) else {
        return false;
    };
    if line.starts_with("```") {
        return false;
    }
    let trimmed = line.trim_end_matches(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                '*' | '_'
                    | '`'
                    | '"'
                    | '\''
                    | ')'
                    | ']'
                    | '}'
                    | '」'
                    | '』'
                    | '）'
                    | '”'
                    | '’'
                    | '>'
            )
    });
    trimmed.ends_with('?') || trimmed.ends_with('？')
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
fn last_assistant_text(transcript: &str) -> Option<String> {
    let mut last = None;
    for entry in lines(transcript) {
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

/// The shell commands the entry ran, when it is a tool call.
fn commands(entry: &Value, out: &mut Vec<String>) {
    if entry["type"] == "assistant" {
        if let Some(blocks) = entry["message"]["content"].as_array() {
            for block in blocks {
                if block["type"] == "tool_use"
                    && let Some(c) = block["input"]["command"].as_str()
                {
                    out.push(c.to_string());
                }
            }
        }
    } else if entry["type"] == "response_item" {
        let payload = &entry["payload"];
        match payload["type"].as_str() {
            Some("function_call") | Some("custom_tool_call") => {
                if let Some(args) = payload["arguments"].as_str().or(payload["input"].as_str()) {
                    out.push(args.to_string());
                }
            }
            Some("local_shell_call") => out.push(payload["action"]["command"].to_string()),
            _ => {}
        }
    }
}

/// Whether, since the last real user message, a command ran
/// `agboard ... message ask` or `... message answer`.
pub(crate) fn turn_asked_on_board(transcript: &str, turn_id: Option<&str>) -> bool {
    let entries: Vec<Value> = lines(transcript).collect();
    // Codex: after the `task_started` of this turn, else of the last one.
    // Claude Code: after the last real user message.
    let start = entries
        .iter()
        .rposition(|e| is_task_started(e, turn_id))
        .or_else(|| entries.iter().rposition(|e| is_task_started(e, None)))
        .or_else(|| entries.iter().rposition(is_user_message))
        .map_or(0, |i| i + 1);
    let mut found = Vec::new();
    for entry in &entries[start..] {
        commands(entry, &mut found);
    }
    found.iter().any(|c| is_board_message_command(c))
}

fn is_board_message_command(command: &str) -> bool {
    let tokens: Vec<&str> = command
        .split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '\\' | ',' | '[' | ']'))
        .filter(|t| !t.is_empty())
        .collect();
    let Some(from) = tokens
        .iter()
        .position(|t| *t == "agboard" || t.ends_with("/agboard"))
    else {
        return false;
    };
    tokens[from..]
        .windows(2)
        .any(|w| w[0] == "message" && matches!(w[1], "ask" | "answer"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> String {
        serde_json::json!({"type":"user","message":{"role":"user","content":text}}).to_string()
    }
    fn assistant_text(text: &str) -> String {
        serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":text}]}})
            .to_string()
    }
    fn bash(command: &str) -> String {
        serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":command}}]}}).to_string()
    }
    fn tool_result(text: &str) -> String {
        serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","content":text}]}}).to_string()
    }

    #[test]
    fn detects_a_final_question() {
        assert!(ends_with_question("Done.\n\nShould I go ahead?"));
        assert!(ends_with_question("進めてよいですか？\n"));
        assert!(ends_with_question("Shall I continue? **\n\n"));
        assert!(ends_with_question("(Is that right?)"));
        assert!(!ends_with_question("Why? Because it is faster."));
        assert!(!ends_with_question("All done."));
        assert!(!ends_with_question("What next?\nDone."));
        assert!(!ends_with_question("```\nx?\n```"));
        assert!(!ends_with_question("  \n"));
    }

    #[test]
    fn a_board_question_in_this_turn_counts_but_an_earlier_one_does_not() {
        let ask = "agboard --project \"x\" message ask --actor ai --questions-json '{}' --json";
        let this_turn = [
            user("hi"),
            bash(ask),
            tool_result("ok"),
            assistant_text("Q?"),
        ]
        .join("\n");
        assert!(turn_asked_on_board(&this_turn, None));
        let earlier = [
            user("hi"),
            bash(ask),
            user("next"),
            bash("ls"),
            assistant_text("Q?"),
        ]
        .join("\n");
        assert!(!turn_asked_on_board(&earlier, None));
        let answer = [
            user("hi"),
            bash("/usr/bin/agboard message answer Q-1 --actor human --via chat"),
        ]
        .join("\n");
        assert!(turn_asked_on_board(&answer, None));
        let other = [
            user("hi"),
            bash("agboard message show Q-1"),
            bash("echo message ask"),
        ]
        .join("\n");
        assert!(!turn_asked_on_board(&other, None));
    }

    #[test]
    fn tool_results_do_not_start_a_turn_and_skill_text_is_not_a_command() {
        let ask = "agboard message ask --actor ai";
        let t = [
            user("go"),
            bash(ask),
            tool_result("agboard message ask in a result"),
            assistant_text("done?"),
        ]
        .join("\n");
        assert!(turn_asked_on_board(&t, None));
        let read_only = [user("go"), tool_result("agboard message ask")].join("\n");
        assert!(!turn_asked_on_board(&read_only, None));
    }

    fn codex_line(kind: &str, payload: Value) -> String {
        let mut p = payload;
        p["type"] = kind.into();
        let outer = if kind.starts_with("task_") {
            "event_msg"
        } else {
            "response_item"
        };
        serde_json::json!({"timestamp":"t","ordinal":1,"type":outer,"payload":p}).to_string()
    }

    #[test]
    fn codex_rollouts_are_scanned_by_turn_id() {
        let ask_js = r#"const r = await tools.exec_command({cmd: "agboard --project demo message ask --actor ai --json"}); text(r);"#;
        let t = [
            codex_line("task_started", serde_json::json!({"turn_id":"turn-1"})),
            codex_line("custom_tool_call", serde_json::json!({"name":"exec","input":ask_js})),
            codex_line("task_started", serde_json::json!({"turn_id":"turn-2"})),
            // Injected context is a user message but starts no turn.
            codex_line("message", serde_json::json!({"role":"user","content":[{"type":"input_text","text":"context"}]})),
            codex_line("function_call", serde_json::json!({"name":"shell","arguments":"{\"command\":[\"ls\"]}"})),
            codex_line("message", serde_json::json!({"role":"assistant","content":[{"type":"output_text","text":"Which one?"}]})),
        ]
        .join("\n");
        // The ask belongs to turn 1, not to turn 2 or the last turn.
        assert!(!turn_asked_on_board(&t, Some("turn-2")));
        assert!(!turn_asked_on_board(&t, None));
        assert!(turn_asked_on_board(&t, Some("turn-1")));
        assert_eq!(last_assistant_text(&t).as_deref(), Some("Which one?"));
        let fc = [
            codex_line("task_started", serde_json::json!({"turn_id":"turn-3"})),
            codex_line("function_call", serde_json::json!({"name":"exec_command","arguments":"{\"cmd\":\"agboard message answer Q-1 --actor human --via chat\"}"})),
        ]
        .join("\n");
        assert!(turn_asked_on_board(&fc, Some("turn-3")));
    }

    #[test]
    fn decide_blocks_once_and_only_without_a_board_question() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        std::fs::write(
            &path,
            [user("hi"), assistant_text("May I proceed?")].join("\n"),
        )
        .unwrap();
        let p = path.to_str().unwrap();
        let out = decide(false, Some("May I proceed?"), Some(p), None).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["decision"], "block");
        assert!(v["reason"].as_str().unwrap().contains("message ask"));
        // Already continued once, or no question, or no transcript: nothing.
        assert!(decide(true, Some("May I proceed?"), Some(p), None).is_none());
        assert!(decide(false, Some("All done."), Some(p), None).is_none());
        assert!(decide(false, Some("May I proceed?"), None, None).is_none());
        assert!(decide(false, Some("May I proceed?"), Some("/no/such/file"), None).is_none());
        // The message comes from the transcript when the input has none.
        assert!(decide(false, None, Some(p), None).is_some());
        // A board question in the turn lets it end.
        std::fs::write(
            &path,
            [
                user("hi"),
                bash("agboard message ask --actor ai"),
                assistant_text("May I proceed?"),
            ]
            .join("\n"),
        )
        .unwrap();
        assert!(decide(false, Some("May I proceed?"), Some(p), None).is_none());
    }
}
