use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::{
    clock::{Clock, SystemClock, format_utc},
    store::Store,
};

const MAX_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    fetched_at: String,
    revision: i64,
    board: &'a crate::domain::BoardMeta,
    cards: &'a [crate::domain::Card],
}

pub fn run(agent: &str, input: &mut dyn Read, db_path: &Path) -> Option<String> {
    let mut bytes = Vec::new();
    if input
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_BYTES
    {
        return Some(error_output(
            "hook_input_too_large",
            "Hook input exceeded 64 KiB.",
        ));
    }
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            return Some(error_output(
                "invalid_hook_input",
                "Hook input was not valid JSON.",
            ));
        }
    };
    let event = value
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let allowed = match agent {
        "claude" => matches!(event, "PostToolUse" | "PostToolUseFailure" | "SessionStart"),
        "codex" => matches!(event, "PostToolUse" | "SessionStart"),
        _ => false,
    };
    if !allowed {
        return None;
    }

    let result = (|| -> Result<String, String> {
        if !db_path.exists() {
            return Err("Board database does not exist.".into());
        }
        let store = Store::open_read_only(db_path).map_err(|e| e.to_string())?;
        let snapshot = store.snapshot().map_err(|e| e.to_string())?;
        let payload = Snapshot {
            fetched_at: format_utc(SystemClock.now()),
            revision: snapshot.revision,
            board: &snapshot.board,
            cards: &snapshot.cards,
        };
        let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        let context = format!("AGBOARD_SNAPSHOT\n{json}");
        if context.len() > MAX_BYTES {
            return Err("Complete board snapshot exceeds 64 KiB.".into());
        }
        Ok(context)
    })();
    let context = result.unwrap_or_else(|reason| {
        let code = if reason.contains("exceeds 64 KiB") { "context_too_large" } else { "board_unavailable" };
        format!("AGBOARD_ERROR\n{{\"code\":{code:?},\"reason\":{}}}\nDo not make board-dependent changes until a complete snapshot is available.", serde_json::to_string(&reason).unwrap_or_else(|_| "\"unavailable\"".into()))
    });
    Some(serde_json::json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":context}}).to_string())
}

fn error_output(code: &str, reason: &str) -> String {
    let event = "PostToolUse";
    serde_json::json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":format!("AGBOARD_ERROR\n{{\"code\":{code:?},\"reason\":{reason:?}}}\nDo not make board-dependent changes until a complete snapshot is available.")}}).to_string()
}
