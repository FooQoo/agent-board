//! The Stop hook: at the end of a turn, runs a list of reminder rules and
//! blocks the turn once, with one reason, when any of them matches.
//!
//! A rule is an id and a check (see [`rules`]); adding one is adding an entry
//! to [`rules::RULES`]. Every failure means "do nothing": this hook must never
//! fail a turn.

mod rules;
mod turn;

use std::cell::OnceCell;
use std::path::Path;

use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::progress::{self, Include, Progress};

pub(crate) use rules::{RULES, Rule};
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

/// The input of a Stop event, as far as the rules use it.
pub(crate) struct StopInput<'a> {
    pub stop_hook_active: bool,
    pub last_assistant_message: Option<&'a str>,
    pub transcript_path: Option<&'a str>,
    pub turn_id: Option<&'a str>,
}

/// The hook's output for a bound project, or `None` to let the turn end.
pub(crate) fn run(input: &StopInput, shared: &Path, project: &ProjectId) -> Option<String> {
    if input.stop_hook_active {
        return None;
    }
    let store = FileStore::open(shared);
    let turn = input
        .transcript_path
        .and_then(|path| turn::read_turn(path, input.turn_id));
    let ctx = Ctx::new(input.last_assistant_message, turn, Some((&store, project)));
    decide(&ctx, RULES)
}

/// Runs every rule; one block with every matched message, or `None`.
pub(crate) fn decide(ctx: &Ctx, rules: &[Rule]) -> Option<String> {
    let matched: Vec<String> = rules
        .iter()
        .filter_map(|rule| (rule.check)(ctx).map(|m| format!("- [{}] {m}", rule.id)))
        .collect();
    if matched.is_empty() {
        return None;
    }
    let reason = format!(
        "Before you end your turn, deal with each of these Agent Board reminders:\n{}",
        matched.join("\n")
    );
    Some(serde_json::json!({"decision": "block", "reason": reason}).to_string())
}

#[cfg(test)]
mod tests;
