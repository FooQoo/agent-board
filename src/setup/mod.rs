//! `agboard setup` and `agboard update`: prepare the data directory, install
//! the Agent Board plugin (the Skill and the Hook) with each agent's own
//! plugin commands, give the agents access to the shared folder, and, for
//! Codex, trust the plugin's hooks.
//!
//! A run has two phases. Everything is planned first without a change
//! ([`prepare`]): the agent commands are found on `PATH`, the installed
//! plugin is read, and every settings file is read, validated and its new
//! bytes computed. Nothing is written if a settings file cannot be used. The
//! plan is then shown, and carried out after the user agrees ([`execute`]).
//! A dry run stops after the plan, so both share the same checks.

pub(crate) mod agent_cli;
pub(crate) mod apply;
pub(crate) mod claude;
pub(crate) mod codex;
pub(crate) mod env;
mod execute;
pub(crate) mod plan;
pub(crate) mod plugin;
mod prepare;
mod report;
pub(crate) mod trust;

pub use env::SetupEnv;
pub use execute::execute;
pub use prepare::{AgentPlan, Prepared, available, prepare};
pub use report::{AgentReport, FileReport, SetupReport, Status};

/// The agboard version, which is also the version of the plugin it installs.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// An agent setup works with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Codex,
    Claude,
}

impl Agent {
    pub const ALL: [Agent; 2] = [Agent::Codex, Agent::Claude];

    /// The name used in `--agent` and in JSON output. It is also the name of
    /// the agent's command.
    pub fn key(self) -> &'static str {
        match self {
            Agent::Codex => "codex",
            Agent::Claude => "claude",
        }
    }

    /// The name used in human-readable output.
    pub fn label(self) -> &'static str {
        match self {
            Agent::Codex => "Codex",
            Agent::Claude => "Claude Code",
        }
    }
}

/// Which command runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// First setup: data directory, plugin, permissions and hook trust.
    Setup,
    /// Moves an installed plugin to this version and trusts its hooks again.
    Update,
}

impl Mode {
    pub fn command(self) -> &'static str {
        match self {
            Mode::Setup => "setup",
            Mode::Update => "update",
        }
    }
}

/// What a run was asked to do.
#[derive(Debug, Clone)]
pub struct SetupOptions {
    pub mode: Mode,
    pub agents: Vec<Agent>,
    pub dry_run: bool,
}
