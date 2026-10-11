//! The agent hook: adds one project's complete board snapshot to an agent's
//! context, or says plainly that it could not.

use std::io::Read;
use std::path::Path;

use crate::{
    clock::{Clock, SystemClock, format_utc},
    domain::validate_project_name,
    error::AgboardError,
    file_store::{FileStore, reader::FetchedSnapshot},
};

/// Largest hook input read, in UTF-8 bytes.
const MAX_INPUT_BYTES: usize = 64 * 1024;

/// Largest snapshot JSON passed on, in UTF-8 bytes.
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024;

/// Why no snapshot could be produced. Shown to the agent as `AGBOARD_ERROR`.
struct Failure {
    code: &'static str,
    reason: String,
}

impl Failure {
    fn new(code: &'static str, reason: impl Into<String>) -> Failure {
        Failure {
            code,
            reason: reason.into(),
        }
    }
}

/// Run the hook for the project named `project`. The name is resolved to a
/// project ID once, in one read-only look at the board, and only that project's
/// snapshot (all its cards and their whole history) is returned.
///
/// A missing, unknown or unreadable project is reported as `AGBOARD_ERROR`
/// context; the hook never writes, never guesses another project and never
/// blocks the agent's tool result. Events the agent does not use return `None`.
pub fn run(
    agent: &str,
    input: &mut dyn Read,
    shared: &Path,
    project: Option<&str>,
) -> Option<String> {
    let mut bytes = Vec::new();
    if input
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_INPUT_BYTES
    {
        return Some(output(
            "PostToolUse",
            &error_context(&Failure::new(
                "hook_input_too_large",
                "Hook input exceeded 64 KiB.",
            )),
        ));
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Some(output(
            "PostToolUse",
            &error_context(&Failure::new(
                "invalid_hook_input",
                "Hook input was not valid JSON.",
            )),
        ));
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
    let context = snapshot_context(shared, project).unwrap_or_else(|f| error_context(&f));
    Some(output(event, &context))
}

/// The `AGBOARD_SNAPSHOT` context for the named project, read from the shared files.
fn snapshot_context(shared: &Path, project: Option<&str>) -> Result<String, Failure> {
    let name = project.ok_or_else(|| {
        Failure::new(
            "invalid_argument",
            "--project NAME is required. Name the project in the hook command.",
        )
    })?;
    let name = validate_project_name(name)
        .map_err(|error| Failure::new("invalid_value", error.reason()))?;
    let store = FileStore::open(shared);
    let meta = store.project_by_name(&name).map_err(|error| match error {
        AgboardError::ProjectNotFound { .. } => Failure::new("project_not_found", error.reason()),
        other => Failure::new("board_unavailable", other.reason()),
    })?;
    let snapshot = store.board(&meta.id).map_err(|error| match error {
        AgboardError::ProjectNotFound { .. } => Failure::new("project_not_found", error.reason()),
        other => Failure::new("board_unavailable", other.reason()),
    })?;
    let json = serde_json::to_string(&FetchedSnapshot {
        fetched_at: format_utc(SystemClock.now()),
        snapshot: &snapshot,
    })
    .map_err(|error| Failure::new("board_unavailable", error.to_string()))?;
    snapshot_text(&json)
}

/// Frame the snapshot JSON, or refuse it when it is over the limit. The whole
/// JSON is passed or none of it: a snapshot is never cut short.
fn snapshot_text(json: &str) -> Result<String, Failure> {
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(Failure::new(
            "context_too_large",
            format!(
                "The complete board snapshot is {} bytes, over the 256 KiB limit.",
                json.len()
            ),
        ));
    }
    Ok(format!("AGBOARD_SNAPSHOT\n{json}"))
}

fn error_context(failure: &Failure) -> String {
    let body = serde_json::json!({"code": failure.code, "reason": failure.reason});
    format!(
        "AGBOARD_ERROR\n{body}\nDo not make board-dependent changes until a complete snapshot is available."
    )
}

fn output(event: &str, context: &str) -> String {
    serde_json::json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":context}})
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limit_counts_utf8_bytes_of_the_snapshot_json() {
        let at_limit = "a".repeat(MAX_SNAPSHOT_BYTES);
        assert!(snapshot_text(&at_limit).is_ok());
        let over = "a".repeat(MAX_SNAPSHOT_BYTES + 1);
        assert_eq!(
            snapshot_text(&over).err().unwrap().code,
            "context_too_large"
        );
        // Fewer characters than the limit, more bytes than the limit.
        let wide = "あ".repeat(MAX_SNAPSHOT_BYTES / 3 + 1);
        assert!(wide.chars().count() < MAX_SNAPSHOT_BYTES);
        assert_eq!(
            snapshot_text(&wide).err().unwrap().code,
            "context_too_large"
        );
        // The text that is passed on is the whole JSON, untouched.
        assert_eq!(
            snapshot_text("{\"a\":1}").ok().unwrap(),
            "AGBOARD_SNAPSHOT\n{\"a\":1}"
        );
    }
}
