//! The Stop hook: at the end of a turn, runs a list of rules that each give
//! checklist items, and blocks the turn once, with the checklist, when there
//! is any item.
//!
//! A rule is an id and a check (see [`rules`]); adding one is adding an entry
//! to [`rules::RULES`]. Every failure means "do nothing": this hook must never
//! fail a turn.

mod rules;
mod turn;

use std::cell::OnceCell;
use std::path::Path;

use crate::clock::{Clock, SystemClock};
use crate::domain::{ProjectId, validate_project_name};
use crate::file_store::FileStore;
use crate::progress::{self, Include, Progress};

pub(crate) use rules::{Item, Kind, RULES, Rule};
pub(crate) use turn::{Call, Turn};

/// What a rule can look at.
pub(crate) struct Ctx<'a> {
    /// The reply text from the Stop input, when it has one.
    pub message: Option<&'a str>,
    /// The turn as the transcript shows it. `None` when it cannot be read.
    pub turn: Option<Turn>,
    board: Option<(&'a FileStore, &'a ProjectId)>,
    progress: OnceCell<Option<Progress>>,
}

impl<'a> Ctx<'a> {
    pub(crate) fn new(
        message: Option<&'a str>,
        turn: Option<Turn>,
        board: Option<(&'a FileStore, &'a ProjectId)>,
    ) -> Self {
        Ctx {
            message,
            turn,
            board,
            progress: OnceCell::new(),
        }
    }

    /// The last reply: from the input, else from the transcript.
    pub(crate) fn reply(&self) -> Option<&str> {
        self.message
            .filter(|text| !text.trim().is_empty())
            .or_else(|| self.turn.as_ref()?.last_text.as_deref())
    }

    /// The tool calls of the turn, empty when it cannot be read.
    pub(crate) fn calls(&self) -> &[Call] {
        self.turn.as_ref().map_or(&[], |t| &t.calls)
    }

    /// The bound project's progress table, read once and only when a rule
    /// asks for it. `None` when it cannot be read.
    pub(crate) fn progress(&self) -> Option<&Progress> {
        self.progress
            .get_or_init(|| {
                let (store, project) = self.board?;
                let snapshot = store.board(project).ok()?;
                Some(progress::build_with(
                    &snapshot,
                    store.shared_dir(),
                    SystemClock.now(),
                    Include::default(),
                ))
            })
            .as_ref()
    }
}

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
        .and_then(|path| turn::read_turn(path, input.turn_id.as_deref()));
    let ctx = Ctx::new(
        input.last_assistant_message.as_deref(),
        turn,
        Some((&store, project)),
    );
    decide(&ctx, RULES)
}

/// Runs every rule; one block with the checklist, or `None` when no rule
/// has an item. Items the hook confirmed (`NG`) are listed apart from items
/// the agent must judge (`[ ]`).
pub(crate) fn decide(ctx: &Ctx, rules: &[Rule]) -> Option<String> {
    let items: Vec<Item> = rules.iter().flat_map(|rule| (rule.check)(ctx)).collect();
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
#[cfg(test)]
mod turn_tests;
