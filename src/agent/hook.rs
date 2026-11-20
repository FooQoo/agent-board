//! The agent hook: adds the project's read-only progress table to an agent's
//! context, or says plainly that it could not.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::{
    clock::{Clock, SystemClock},
    domain::{ProjectId, validate_project_name},
    error::AgboardError,
    file_store::FileStore,
    progress::{self, Include},
    server::preferences::saved_locale,
};

/// Largest progress JSON passed on, in UTF-8 bytes.
const MAX_PROGRESS_BYTES: usize = 256 * 1024;

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

/// Run the hook for an explicitly named project, or infer it from the nearest
/// registered ancestor of the `cwd` supplied in the hook input. When the input
/// has no `cwd`, the process working directory is used.
///
/// The hook returns the same progress data as `agboard progress --json`. It
/// changes no board file and never builds a shell command from hook input.
pub fn run(
    agent: &str,
    input: &mut dyn Read,
    shared: &Path,
    project: Option<&str>,
) -> Option<String> {
    run_with(agent, input, shared, project, Include::default())
}

/// [`run`] with the extra progress sections named by `include`.
pub fn run_with(
    agent: &str,
    input: &mut dyn Read,
    shared: &Path,
    project: Option<&str>,
    include: Include,
) -> Option<String> {
    run_reporting(agent, input, shared, project, include).output
}

/// What the hook printed, and the project whose progress table it found.
pub struct HookRun {
    pub output: Option<String>,
    /// A progress table was produced: the agent is working on this board.
    pub board: Option<ProjectId>,
    /// The hook event the input named, when it was an allowed one.
    pub event: Option<String>,
}

/// [`run_with`], also saying whether a progress table was produced, so the
/// command line can start the server for the agent's board.
pub fn run_reporting(
    agent: &str,
    input: &mut dyn Read,
    shared: &Path,
    project: Option<&str>,
    include: Include,
) -> HookRun {
    let mut board = None;
    let mut event = None;
    let output = hook_output(
        agent, input, shared, project, include, &mut board, &mut event,
    );
    HookRun {
        output,
        board,
        event,
    }
}

/// The fields of the hook input the hook uses. Every other field, the tool
/// input and result included, is skipped.
#[derive(serde::Deserialize)]
struct HookInput {
    #[serde(default)]
    hook_event_name: Option<serde_json::Value>,
    #[serde(default)]
    cwd: Option<serde_json::Value>,
    /// Stop only: the turn was already continued by a Stop hook.
    #[serde(default)]
    stop_hook_active: Option<bool>,
    #[serde(default)]
    last_assistant_message: Option<String>,
    #[serde(default)]
    transcript_path: Option<String>,
}

fn hook_output(
    agent: &str,
    input: &mut dyn Read,
    shared: &Path,
    project: Option<&str>,
    include: Include,
    board: &mut Option<ProjectId>,
    seen_event: &mut Option<String>,
) -> Option<String> {
    // The input is read to the end whatever its size: it comes from the local
    // agent, and after a large tool result (an image, a long command output)
    // it is large through no fault of the board. Only two fields are used;
    // the tool input and result are skipped without being kept.
    let mut bytes = Vec::new();
    if input.read_to_end(&mut bytes).is_err() {
        return Some(output(
            "PostToolUse",
            &error_context(&Failure::new(
                "invalid_hook_input",
                "Hook input could not be read.",
            )),
        ));
    }
    let Ok(input) = serde_json::from_slice::<HookInput>(&bytes) else {
        return Some(output(
            "PostToolUse",
            &error_context(&Failure::new(
                "invalid_hook_input",
                "Hook input was not valid JSON.",
            )),
        ));
    };
    let event = input
        .hook_event_name
        .as_ref()
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if event == "Stop" && matches!(agent, "claude" | "codex") {
        return stop_output(shared, project, &input);
    }
    let allowed = match agent {
        "claude" => matches!(event, "PostToolUse" | "PostToolUseFailure" | "SessionStart"),
        "codex" => matches!(event, "PostToolUse" | "SessionStart"),
        _ => false,
    };
    if !allowed {
        return None;
    }
    *seen_event = Some(event.to_string());
    let context = match progress_context(shared, project, input.cwd.as_ref(), include) {
        Ok(Some((context, project))) => {
            *board = Some(project);
            context
        }
        // A readable folder with no bound ancestor is not an error: say nothing.
        Ok(None) => return None,
        Err(failure) => error_context(&failure),
    };
    Some(output(event, &context))
}

/// The Stop event: block the turn once when it ends with a question that is
/// not on the board. A folder with no project, or any failure, says nothing.
fn stop_output(shared: &Path, project: Option<&str>, input: &HookInput) -> Option<String> {
    if input.stop_hook_active == Some(true) {
        return None;
    }
    let store = FileStore::open(shared);
    if let Some(name) = project {
        let name = validate_project_name(name).ok()?;
        store.project_by_name(&name).ok()?;
    } else {
        let cwd = hook_folder(input.cwd.as_ref()).ok()?;
        store.resolve_binding(&cwd).ok()??;
    }
    super::stop::decide(
        false,
        input.last_assistant_message.as_deref(),
        input.transcript_path.as_deref(),
    )
}

/// Adds a SessionStart `notice` to the hook's `output`. With no output (an
/// unbound folder) the notice is the whole output.
pub fn with_session_notice(output: Option<String>, notice: Option<String>) -> Option<String> {
    let Some(notice) = notice else {
        return output;
    };
    let Some(output) = output else {
        return Some(self::output("SessionStart", &notice));
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&output) else {
        return Some(output);
    };
    let Some(specific) = value.get_mut("hookSpecificOutput") else {
        return Some(output);
    };
    let context = specific
        .get("additionalContext")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    specific["additionalContext"] = serde_json::Value::String(format!("{context}\n\n{notice}"));
    Some(value.to_string())
}

/// The folder the hook runs for: a non-empty absolute `cwd` from the input, or
/// the process folder when the input gives none (missing, null, or empty). A
/// value that cannot be used is reported, never taken for "no folder".
fn hook_folder(input_cwd: Option<&serde_json::Value>) -> Result<PathBuf, Failure> {
    let unavailable = |what: String| Failure::new("hook_cwd_unavailable", what);
    let given = match input_cwd {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(text)) if text.is_empty() => None,
        Some(serde_json::Value::String(text)) => Some(PathBuf::from(text)),
        Some(_) => {
            return Err(Failure::new(
                "invalid_hook_input",
                "Hook input cwd must be a string.",
            ));
        }
    };
    let path = match given {
        Some(path) if !path.is_absolute() => {
            return Err(Failure::new(
                "invalid_hook_input",
                "Hook input cwd must be an absolute path.",
            ));
        }
        Some(path) => path,
        None => std::env::current_dir()
            .map_err(|e| unavailable(format!("The current folder is not available: {e}")))?,
    };
    let canonical = std::fs::canonicalize(&path).map_err(|e| {
        unavailable(format!(
            "The folder {} cannot be resolved: {e}",
            path.display()
        ))
    })?;
    std::fs::read_dir(&canonical)
        .map_err(|e| unavailable(format!("The folder {} cannot be read: {e}", path.display())))?;
    Ok(canonical)
}

/// The `AGBOARD_PROGRESS` context generated by the same function as the CLI,
/// and the project it is for.
/// `None` means the folder is readable and no bound folder contains it. That is
/// decided before any board content is read.
fn progress_context(
    shared: &Path,
    project: Option<&str>,
    input_cwd: Option<&serde_json::Value>,
    include: Include,
) -> Result<Option<(String, ProjectId)>, Failure> {
    let store = FileStore::open(shared);
    let failed = |error: AgboardError| Failure::new(error.code(), error.reason());
    let meta = if let Some(name) = project {
        let name = validate_project_name(name)
            .map_err(|error| Failure::new("invalid_value", error.reason()))?;
        store.project_by_name(&name).map_err(failed)?
    } else {
        let cwd = hook_folder(input_cwd)?;
        match store.resolve_binding(&cwd).map_err(failed)? {
            Some(resolved) => resolved.project,
            None => return Ok(None),
        }
    };
    let snapshot = store.board(&meta.id).map_err(failed)?;
    let mut value = progress::build_with(&snapshot, store.shared_dir(), SystemClock.now(), include);
    value.locale = saved_locale(store.shared_dir());
    let json = serde_json::to_string(&value)
        .map_err(|error| Failure::new("board_unavailable", error.to_string()))?;
    progress_text(&json).map(|text| Some((text, meta.id)))
}

/// Frame the progress JSON, or refuse it when it is over the limit. The whole
/// progress table is passed or none of it: it is never cut short.
fn progress_text(json: &str) -> Result<String, Failure> {
    if json.len() > MAX_PROGRESS_BYTES {
        return Err(Failure::new(
            "context_too_large",
            format!(
                "The complete progress table is {} bytes, over the 256 KiB limit.",
                json.len()
            ),
        ));
    }
    Ok(format!("AGBOARD_PROGRESS\n{json}"))
}

fn error_context(failure: &Failure) -> String {
    let body = serde_json::json!({"code": failure.code, "reason": failure.reason});
    format!(
        "AGBOARD_ERROR\n{body}\nDo not make board-dependent changes until a complete progress table is available."
    )
}

/// The hook's JSON for `event` with `context` as the agent's added context.
pub(crate) fn output(event: &str, context: &str) -> String {
    serde_json::json!({"hookSpecificOutput":{"hookEventName":event,"additionalContext":context}})
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limit_counts_utf8_bytes_of_the_progress_json() {
        let at_limit = "a".repeat(MAX_PROGRESS_BYTES);
        assert!(progress_text(&at_limit).is_ok());
        let over = "a".repeat(MAX_PROGRESS_BYTES + 1);
        assert_eq!(
            progress_text(&over).err().unwrap().code,
            "context_too_large"
        );
        // Fewer characters than the limit, more bytes than the limit.
        let wide = "あ".repeat(MAX_PROGRESS_BYTES / 3 + 1);
        assert!(wide.chars().count() < MAX_PROGRESS_BYTES);
        assert_eq!(
            progress_text(&wide).err().unwrap().code,
            "context_too_large"
        );
        assert_eq!(
            progress_text("{\"a\":1}").ok().unwrap(),
            "AGBOARD_PROGRESS\n{\"a\":1}"
        );
    }
}
