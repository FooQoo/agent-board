//! The vocabulary of an apply run: the steps an observer sees (tests use it
//! to inject failures and crashes), and the result reported for each agent.

use std::path::{Path, PathBuf};

use super::merge::Conflict;
use super::recovery::RecoveryReport;
use super::types::Agent;

/// Where in a transaction a step is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Before the backup or the staging of one target.
    Backup,
    /// Before the replace (rename) of one target.
    Rename,
    /// Before the registry is committed.
    Registry,
    /// Before one target is undone.
    Recovery,
}

/// What an observer is told before a step.
#[derive(Debug, Clone, Copy)]
pub struct Step<'a> {
    pub phase: Phase,
    pub index: usize,
    pub path: &'a Path,
}

/// What an observer decides. Tests inject failures and crashes with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepAction {
    Continue,
    /// The step fails; the run is undone.
    Fail(String),
    /// The process "dies" here: nothing is undone and the journal stays.
    Crash,
}

pub type Observer<'a> = &'a dyn Fn(&Step) -> StepAction;

/// Options of an apply run.
#[derive(Default, Clone, Copy)]
pub struct ApplyOptions<'a> {
    pub observer: Option<Observer<'a>>,
}

#[derive(Debug)]
pub(crate) enum Abort {
    Fail(String),
    Crash(String),
}

pub(crate) fn notify(
    observer: Option<Observer>,
    phase: Phase,
    index: usize,
    path: &Path,
) -> Result<(), Abort> {
    match observer.map(|o| o(&Step { phase, index, path })) {
        None | Some(StepAction::Continue) => Ok(()),
        Some(StepAction::Fail(reason)) => Err(Abort::Fail(reason)),
        Some(StepAction::Crash) => Err(Abort::Crash("interrupted by an injected crash".into())),
    }
}

/// The result for one agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Applied,
    Unchanged,
    /// Conflicts or manual steps stopped the agent before any write.
    Blocked,
    /// A write failed. See `rollback` for whether the agent is back to its start.
    Failed,
    /// The run was cut short and its journal is pending (only with an injected crash).
    Interrupted,
}

#[derive(Debug, Clone)]
pub struct AgentOutcome {
    pub agent: Agent,
    pub status: Status,
    /// What was changed (for `Applied`).
    pub changes: Vec<String>,
    /// Backups that exist after the run.
    pub backups: Vec<PathBuf>,
    pub conflicts: Vec<Conflict>,
    pub manual_steps: Vec<String>,
    pub message: Option<String>,
    /// For `Failed`: how the undo went.
    pub rollback: Option<RecoveryReport>,
}

impl AgentOutcome {
    pub(super) fn new(agent: Agent, status: Status) -> Self {
        AgentOutcome {
            agent,
            status,
            changes: Vec::new(),
            backups: Vec::new(),
            conflicts: Vec::new(),
            manual_steps: Vec::new(),
            message: None,
            rollback: None,
        }
    }
    pub(super) fn failed(agent: Agent, message: String) -> Self {
        AgentOutcome {
            message: Some(message),
            ..Self::new(agent, Status::Failed)
        }
    }
    pub fn succeeded(&self) -> bool {
        matches!(self.status, Status::Applied | Status::Unchanged)
    }
}

/// Process exit code for a set of outcomes: 0 when every agent succeeded or
/// had nothing to do, 1 when any agent was blocked, failed, or interrupted.
pub fn exit_code(outcomes: &[AgentOutcome]) -> i32 {
    if outcomes.iter().all(AgentOutcome::succeeded) {
        0
    } else {
        1
    }
}

/// Whether some agents succeeded and some did not.
pub fn is_partial(outcomes: &[AgentOutcome]) -> bool {
    outcomes.iter().any(|o| o.status == Status::Applied) && outcomes.iter().any(|o| !o.succeeded())
}
