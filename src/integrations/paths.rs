//! Placement of the Skill and Hook of each agent. These are pure functions of
//! the environment and of the bound root that the caller supplies; they never
//! look at the working directory and never touch the file system, except
//! [`resolve_links`], which only reads.
//!
//! Placement table (`<bound-root>` is the nearest binding's canonical root):
//!
//! | agent | component | Global | Project |
//! | --- | --- | --- | --- |
//! | claude | skill | `$CLAUDE_CONFIG_DIR/skills/agent-board` (default `~/.claude/...`) | `<bound-root>/.claude/skills/agent-board` |
//! | claude | hook | `$CLAUDE_CONFIG_DIR/settings.json` (default `~/.claude/settings.json`) | `<bound-root>/.claude/settings.json` |
//! | codex | skill | `~/.agents/skills/agent-board` (CODEX_HOME is not used) | `<bound-root>/.agents/skills/agent-board` |
//! | codex | hook | `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`) | `<bound-root>/.codex/hooks.json` |
//!
//! An empty environment variable counts as unset. The registry lives at
//! `<data-dir>/integrations.json`, where the data directory is resolved by
//! the same rule as the CLI (`AGBOARD_HOME`, then `~/.agent-board`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::types::{Agent, Component, EffectivePaths, IntegrationError, ResolvedTargets, Scope};

/// The environment that decides every path. [`PathEnv::from_process`] reads
/// the real process; tests build it by hand and inject fake homes here.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PathEnv {
    pub agboard_home: Option<OsString>,
    pub home: Option<PathBuf>,
    pub codex_home: Option<OsString>,
    pub claude_config_dir: Option<OsString>,
}

impl PathEnv {
    /// The environment of this process.
    pub fn from_process() -> Self {
        PathEnv {
            agboard_home: std::env::var_os("AGBOARD_HOME"),
            home: dirs::home_dir(),
            codex_home: std::env::var_os("CODEX_HOME"),
            claude_config_dir: std::env::var_os("CLAUDE_CONFIG_DIR"),
        }
    }
}

/// The data directory, absolute. Uses the CLI's rule.
pub fn data_dir(env: &PathEnv) -> Result<PathBuf, IntegrationError> {
    let dir = crate::paths::data_dir_from(env.agboard_home.clone(), env.home.clone())
        .map_err(|error| IntegrationError::Board(error.to_string()))?;
    absolute(dir)
}

/// `<data-dir>/integrations.json`.
pub fn registry_path(env: &PathEnv) -> Result<PathBuf, IntegrationError> {
    Ok(data_dir(env)?.join("integrations.json"))
}

/// The absolute location of one component of one agent in one scope.
/// `bound_root` must be absolute when the scope is Project, and is ignored
/// for Global. A Project scope without a bound root is an error.
pub fn placement(
    env: &PathEnv,
    agent: Agent,
    component: Component,
    scope: Scope,
    bound_root: Option<&Path>,
) -> Result<PathBuf, IntegrationError> {
    let path = match scope {
        Scope::Project => {
            let root = bound_root.ok_or(IntegrationError::BindingRequired)?;
            if !root.is_absolute() {
                return Err(IntegrationError::NotAbsolute(root.to_path_buf()));
            }
            root.join(project_relative(agent, component))
        }
        Scope::Global => global_path(env, agent, component)?,
    };
    absolute(path)
}

/// The placement of both components of one agent for the chosen scopes.
pub fn resolve_targets(
    env: &PathEnv,
    agent: Agent,
    skill_scope: Scope,
    hook_scope: Scope,
    bound_root: Option<&Path>,
) -> Result<ResolvedTargets, IntegrationError> {
    let skill = placement(env, agent, Component::Skill, skill_scope, bound_root)?;
    let hook = placement(env, agent, Component::Hook, hook_scope, bound_root)?;
    let uses_project = skill_scope == Scope::Project || hook_scope == Scope::Project;
    Ok(ResolvedTargets {
        agent,
        bound_root: bound_root.filter(|_| uses_project).map(Path::to_path_buf),
        skill_scope,
        hook_scope,
        effective_paths: EffectivePaths { skill, hook },
    })
}

/// `path` with every symbolic link followed: the nearest existing ancestor is
/// canonicalized and the rest is appended. Used to fill `resolvedPath`.
pub fn resolve_links(path: &Path) -> PathBuf {
    let mut rest: Vec<OsString> = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        if let Ok(real) = std::fs::canonicalize(&current) {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (current.file_name(), current.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name.to_owned());
                current = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Where a Project-scope component lives, relative to the bound root.
fn project_relative(agent: Agent, component: Component) -> PathBuf {
    match (agent, component) {
        (Agent::Claude, Component::Skill) => PathBuf::from(".claude/skills/agent-board"),
        (Agent::Claude, Component::Hook) => PathBuf::from(".claude/settings.json"),
        (Agent::Codex, Component::Skill) => PathBuf::from(".agents/skills/agent-board"),
        (Agent::Codex, Component::Hook) => PathBuf::from(".codex/hooks.json"),
    }
}

/// Where a Global-scope component lives, from the environment.
fn global_path(
    env: &PathEnv,
    agent: Agent,
    component: Component,
) -> Result<PathBuf, IntegrationError> {
    Ok(match (agent, component) {
        (Agent::Claude, Component::Skill) => claude_root(env)?.join("skills/agent-board"),
        (Agent::Claude, Component::Hook) => claude_root(env)?.join("settings.json"),
        // Codex Skills follow the official .agents/skills rule, not CODEX_HOME.
        (Agent::Codex, Component::Skill) => {
            home(env, "the Codex Skill directory")?.join(".agents/skills/agent-board")
        }
        (Agent::Codex, Component::Hook) => codex_root(env)?.join("hooks.json"),
    })
}

/// `$CLAUDE_CONFIG_DIR`, or `~/.claude`.
fn claude_root(env: &PathEnv) -> Result<PathBuf, IntegrationError> {
    match non_empty(&env.claude_config_dir) {
        Some(dir) => Ok(dir),
        None => Ok(home(env, "the default Claude Code directory")?.join(".claude")),
    }
}

/// `$CODEX_HOME`, or `~/.codex`.
fn codex_root(env: &PathEnv) -> Result<PathBuf, IntegrationError> {
    match non_empty(&env.codex_home) {
        Some(dir) => Ok(dir),
        None => Ok(home(env, "the default Codex directory")?.join(".codex")),
    }
}

fn home(env: &PathEnv, what: &'static str) -> Result<PathBuf, IntegrationError> {
    env.home
        .clone()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or(IntegrationError::NoHome { what })
}

fn non_empty(value: &Option<OsString>) -> Option<PathBuf> {
    value
        .as_ref()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Makes `path` absolute against the working directory without touching the
/// file system; no symbolic link is resolved here.
fn absolute(path: PathBuf) -> Result<PathBuf, IntegrationError> {
    std::path::absolute(&path).map_err(|_| IntegrationError::NotAbsolute(path))
}
