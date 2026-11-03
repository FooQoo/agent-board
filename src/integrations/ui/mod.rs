//! How connect and update talk to the person. On a terminal they use the
//! cliclack prompts and styled lines ([`ClackUi`]); otherwise, and in tests
//! that feed lines, the plain text of [`PlainUi`]. Both say the same things
//! and ask the same questions; only the look differs. Nothing here writes a
//! settings file.

mod clack;
mod clack_view;
mod plain;

use std::path::Path;

pub use clack::ClackUi;
pub use plain::PlainUi;

use super::apply::AgentOutcome;
use super::plan::AgentPlan;
use super::prompt::{AgentChoice, Reply};
use super::registry::InstallationRecord;
use super::types::{Agent, Scope};

/// How a message reads: plain output shows them alike, a terminal marks them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Info,
    Warning,
    Error,
}

/// How a run ends, for its last line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    Done,
    Cancelled,
    Failed,
}

/// The questions and messages of connect and update.
pub trait Ui {
    /// The opening. `title` names the command; `text` is the project and
    /// root (plain output shows `text` as it is).
    fn intro(&mut self, title: &str, text: &str);
    /// A message shown with the rest of the run (standard output in plain
    /// output), such as an earlier run that was undone.
    fn say(&mut self, tone: Tone, text: &str);
    /// A reason something could not be done. Plain output writes it to
    /// standard error.
    fn problem(&mut self, text: &str);
    fn select_agents(&mut self, choices: &[AgentChoice], default: &[Agent]) -> Reply<Vec<Agent>>;
    fn select_scope(&mut self, title: &str, root: &Path, default: Scope) -> Reply<Scope>;
    /// The y/N question; no is the default.
    fn confirm(&mut self, question: &str) -> bool;
    /// connect: the plan of every selected agent.
    fn connect_plan(&mut self, plans: &[AgentPlan]);
    /// connect: the result of every agent, ending with the overall line.
    fn connect_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32);
    /// update: what would change for one agent.
    fn update_plan(&mut self, plan: &AgentPlan, records: &[InstallationRecord]);
    /// update: the reasons when no agent can be updated.
    fn update_blocked(&mut self, plans: &[AgentPlan]);
    /// update: where the backups go, before the question.
    fn update_backups(&mut self);
    /// update: the result of every agent, ending with the overall line.
    fn update_results(&mut self, outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32);
    /// The last line of the run.
    fn finish(&mut self, end: End, text: &str);
}
