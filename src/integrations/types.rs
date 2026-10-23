//! Shared vocabulary of the integrations: agents, components, scopes, the
//! resolved targets of one agent, and the error every integration function
//! returns. Keys are the strings used in `--agent`, in the registry file, and
//! in the names of the embedded hook templates.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// An agent that can load the Agent Board Skill and Hooks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
    /// Every supported agent, in the order connect offers them.
    pub const ALL: [Agent; 2] = [Agent::Claude, Agent::Codex];

    /// The stable key: `claude` or `codex`.
    pub fn key(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }

    /// The name shown to people.
    pub fn label(self) -> &'static str {
        match self {
            Agent::Claude => "Claude Code",
            Agent::Codex => "Codex",
        }
    }
}

/// What an installation places: the Skill directory or the Hook settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Component {
    Skill,
    Hook,
}

impl Component {
    /// The stable key: `skill` or `hook`.
    pub fn key(self) -> &'static str {
        match self {
            Component::Skill => "skill",
            Component::Hook => "hook",
        }
    }
}

/// Where a component is installed: the user's agent configuration or the
/// nearest bound project root. Skill scope and Hook scope are chosen
/// independently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Global,
    Project,
}

impl Scope {
    /// The stable key: `global` or `project`.
    pub fn key(self) -> &'static str {
        match self {
            Scope::Global => "global",
            Scope::Project => "project",
        }
    }
}

/// The absolute locations of one agent's Skill directory and Hook settings
/// file, as the chosen scopes place them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectivePaths {
    /// The Skill directory, e.g. `.../skills/agent-board`.
    pub skill: PathBuf,
    /// The settings or hooks file the Hook entries are merged into.
    pub hook: PathBuf,
}

/// The placement of one agent for the chosen scopes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTargets {
    pub agent: Agent,
    /// The nearest binding's canonical root. `None` when no Project scope is
    /// chosen. It is never the working directory of the command.
    pub bound_root: Option<PathBuf>,
    pub skill_scope: Scope,
    pub hook_scope: Scope,
    pub effective_paths: EffectivePaths,
}

/// Why an integration function refused to answer.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IntegrationError {
    #[error("The home directory cannot be found, and {what} needs it.")]
    NoHome { what: &'static str },
    #[error("A project scope needs the bound root of the nearest binding.")]
    BindingRequired,
    #[error("The path must be absolute: {}", .0.display())]
    NotAbsolute(PathBuf),
    #[error("The embedded bundle is invalid: {0}")]
    Bundle(String),
    #[error("The integration registry is invalid: {0}")]
    Registry(String),
    #[error(
        "The integration registry has schemaVersion {0}; this build reads only schemaVersion 1."
    )]
    UnknownSchema(u64),
    #[error("{0}")]
    Board(String),
}
