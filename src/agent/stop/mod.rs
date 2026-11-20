//! The Stop hook: at the end of a turn, runs the rules of the nudge registry
//! (`crate::nudge`) that apply at the turn end, and blocks the turn once, with
//! the checklist, when any gives a reminder. Every failure means "do nothing":
//! this hook must never fail a turn.

use std::path::Path;

use crate::clock::{Clock, SystemClock};
use crate::domain::{ProjectId, validate_project_name};
use crate::file_store::FileStore;
use crate::nudge::{self, Facts, Kind, RULES, Rule};
use crate::progress::{self, Include};

/// The fields of a Stop event's input the rules use.
#[derive(serde::Deserialize, Default)]
pub(crate) struct StopFields {
    #[serde(default)]
    pub stop_hook_active: Option<bool>,
    #[serde(default)]
    pub last_assistant_message: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    /// Codex only: the active turn.
    #[serde(default)]
    pub turn_id: Option<String>,
}

/// The Stop event: `None` (let the turn end) unless the folder, or the
/// project named with `--project`, is bound to a project. Any failure is
/// `None`.
pub(crate) fn run_hook(
    shared: &Path,
    project: Option<&str>,
    cwd: Option<&serde_json::Value>,
    input: &StopFields,
) -> Option<String> {
    if input.stop_hook_active == Some(true) {
        return None;
    }
    let store = FileStore::open(shared);
    let meta = if let Some(name) = project {
        store
            .project_by_name(&validate_project_name(name).ok()?)
            .ok()?
    } else {
        let folder = super::hook::folder_or_none(cwd)?;
        store.resolve_binding(&folder).ok()??.project
    };
    run(input, shared, &meta.id)
}

/// The hook's output for a bound project, or `None` to let the turn end.
pub(crate) fn run(input: &StopFields, shared: &Path, project: &ProjectId) -> Option<String> {
    if input.stop_hook_active == Some(true) {
        return None;
    }
    let store = FileStore::open(shared);
    let turn = input
        .transcript_path
        .as_deref()
        .and_then(|path| nudge::read_turn(path, input.turn_id.as_deref()));
    let now = SystemClock.now();
    let progress = store.board(project).ok().map(|snapshot| {
        progress::build_with(&snapshot, store.shared_dir(), now, Include::default())
    });
    let facts = Facts {
        progress: progress.as_ref(),
        turn: turn.as_ref(),
        message: input.last_assistant_message.as_deref(),
        now,
    };
    decide(&facts, RULES)
}

/// Runs every rule shown at the turn end; one block with the checklist, or
/// `None` when no rule has an item. Items the hook confirmed (`NG`) are listed apart from items
/// the agent must judge (`[ ]`).
pub(crate) fn decide(facts: &Facts, rules: &[Rule]) -> Option<String> {
    let items = nudge::turn_end_reminders(facts, rules);
    if items.is_empty() {
        return None;
    }
    let lines = |kind: Kind, mark: &str| -> Vec<String> {
        items
            .iter()
            .filter(|i| i.kind == kind)
            .map(|i| format!("- {mark}{}", i.text))
            .collect()
    };
    let mut reason = String::from(
        "Agent Board turn-end checklist. Items under 'Found' are confirmed by the hook; handle them. Items under 'Check' are triggered by this turn; handle those that apply and ignore the rest.",
    );
    for (title, body) in [
        ("Found:", lines(Kind::Definite, "NG: ")),
        ("Check:", lines(Kind::Check, "[ ] ")),
    ] {
        if !body.is_empty() {
            reason.push_str(&format!("\n\n{title}\n{}", body.join("\n")));
        }
    }
    Some(serde_json::json!({"decision": "block", "reason": reason}).to_string())
}

#[cfg(test)]
mod tests;
