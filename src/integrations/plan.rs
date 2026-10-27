//! Planning one agent's installation: what connect or update would change,
//! computed from the files as they are now, without writing anything. A plan
//! holds the exact new bytes, the hashes the files must still have when the
//! change is applied, the registry changes, the conflicts that stop it, and
//! the previews shown before the user confirms.
//!
//! Permissions reuse the planning of `agboard setup`: Claude Code's
//! `permissions.additionalDirectories` and Codex's `writable_roots`. A Codex
//! configuration setup cannot change leaves the whole agent unchanged and
//! returns the manual steps.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::assets::{EmbeddedBundle, sha256_hex};
use super::merge::{Conflict, ConflictKind};
use super::paths::{PathEnv, data_dir, placement};
use super::registry::{InstallationRecord, Registry};
use super::template::template_groups;
use super::types::{Agent, Component, IntegrationError, ResolvedTargets, Scope};
use crate::setup::plan::resolve_and_read;

/// Whether an operation changes one file or one Skill directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    File,
    Tree,
}

/// The new content of an operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Payload {
    File(Vec<u8>),
    /// Skill files: path inside the directory and bytes.
    Tree(Vec<(String, Vec<u8>)>),
    Remove,
}

/// One change to one file or directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedOp {
    pub kind: OpKind,
    /// The real path (a symbolic link to a settings file is already followed).
    pub path: PathBuf,
    pub original_hash: Option<String>,
    pub planned_hash: Option<String>,
    pub payload: Payload,
    pub description: String,
}

/// A change to the registry, applied under the transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryChange {
    Upsert(InstallationRecord),
    Remove {
        agent: Agent,
        component: Component,
        scope: Scope,
        bound_root: Option<PathBuf>,
    },
}

/// What planning one agent produced.
#[derive(Debug, Clone)]
pub struct AgentPlan {
    pub agent: Agent,
    pub targets: ResolvedTargets,
    pub ops: Vec<PlannedOp>,
    pub registry_changes: Vec<RegistryChange>,
    /// Permission edits, as setup words them.
    pub permissions: Vec<String>,
    /// Hooks and Skills to add or update.
    pub additions: Vec<String>,
    /// Registrations removed by a scope move.
    pub removals: Vec<String>,
    pub warnings: Vec<String>,
    pub conflicts: Vec<Conflict>,
    /// Steps the user must do by hand; the agent is left unchanged.
    pub manual_steps: Vec<String>,
}

/// Whether a plan can be applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanState {
    Ready,
    Unchanged,
    Blocked,
}

impl AgentPlan {
    pub fn state(&self) -> PlanState {
        if !self.conflicts.is_empty() || !self.manual_steps.is_empty() {
            PlanState::Blocked
        } else if self.ops.is_empty() && self.registry_changes.is_empty() {
            PlanState::Unchanged
        } else {
            PlanState::Ready
        }
    }
}

/// Everything planning reads.
pub struct PlanInput<'a> {
    pub env: &'a PathEnv,
    pub targets: &'a ResolvedTargets,
    /// The nearest bound project; required when a scope is Project.
    pub project_id: Option<&'a str>,
    /// The nearest bound root, also when no scope is Project: Hooks there are
    /// searched for duplicates.
    pub scan_root: Option<&'a Path>,
    pub registry: &'a Registry,
    pub bundle: &'a EmbeddedBundle,
    /// Add the permissions setup adds. Update does not.
    pub permissions: bool,
    /// Take over this root's records in the other scope (a scope move) and
    /// warn about other projects' records. Update plans each recorded scope
    /// separately and moves nothing.
    pub moves: bool,
}

/// The setup planner of one agent's permissions: file, text, data root.
type PermissionPlanner = fn(
    &Path,
    Option<&str>,
    &str,
) -> Result<crate::setup::plan::Planned, crate::error::AgboardError>;

/// One file that may be edited by several steps; the text carries on.
pub(super) struct Stage {
    pub path: PathBuf,
    pub original: Option<Vec<u8>>,
    pub text: Option<String>,
}

#[derive(Default)]
pub(super) struct Stages(pub Vec<Stage>);

impl Stages {
    /// The stage of the file behind `path`, read once.
    pub(super) fn load(&mut self, path: &Path) -> Result<usize, Conflict> {
        let invalid = |detail: String| Conflict::new(ConflictKind::Invalid, path, detail);
        let (real, original) = resolve_and_read(path).map_err(|error| invalid(error.reason()))?;
        if let Some(i) = self.0.iter().position(|s| s.path == real) {
            return Ok(i);
        }
        let text = match &original {
            Some(bytes) => Some(
                String::from_utf8(bytes.clone())
                    .map_err(|_| invalid("is not UTF-8 text.".into()))?,
            ),
            None => None,
        };
        self.0.push(Stage {
            path: real,
            original,
            text,
        });
        Ok(self.0.len() - 1)
    }
}

/// Plans connect for one agent.
pub fn plan_agent(input: &PlanInput) -> Result<AgentPlan, IntegrationError> {
    let agent = input.targets.agent;
    let mut plan = AgentPlan {
        agent,
        targets: input.targets.clone(),
        ops: Vec::new(),
        registry_changes: Vec::new(),
        permissions: Vec::new(),
        additions: Vec::new(),
        removals: Vec::new(),
        warnings: Vec::new(),
        conflicts: Vec::new(),
        manual_steps: Vec::new(),
    };
    let mut stages = Stages::default();
    if input.permissions {
        plan_permissions(input, &mut stages, &mut plan)?;
    }
    if plan.manual_steps.is_empty() {
        let template = template_groups(input.bundle, agent)?;
        super::compose::plan_hook(input, &template, &mut stages, &mut plan)?;
        super::compose::plan_skill(input, &mut plan)?;
    }
    if !plan.conflicts.is_empty() || !plan.manual_steps.is_empty() {
        plan.registry_changes.clear();
        plan.ops.clear();
        return Ok(plan);
    }
    let mut file_ops: Vec<PlannedOp> = stages
        .0
        .into_iter()
        .filter(|s| {
            s.text.as_deref().map(str::as_bytes) != s.original.as_deref() && s.text.is_some()
        })
        .map(|s| {
            let bytes = s.text.unwrap_or_default().into_bytes();
            let verb = if s.original.is_some() {
                "update"
            } else {
                "create"
            };
            PlannedOp {
                kind: OpKind::File,
                description: format!("{verb} {}", s.path.display()),
                original_hash: s.original.as_deref().map(sha256_hex),
                planned_hash: Some(sha256_hex(&bytes)),
                payload: Payload::File(bytes),
                path: s.path,
            }
        })
        .collect();
    file_ops.append(&mut plan.ops);
    plan.ops = file_ops;
    Ok(plan)
}

fn plan_permissions(
    input: &PlanInput,
    stages: &mut Stages,
    plan: &mut AgentPlan,
) -> Result<(), IntegrationError> {
    let agent = input.targets.agent;
    let root = data_dir(input.env)?;
    let root = root
        .to_str()
        .ok_or_else(|| IntegrationError::Board("The data directory path is not UTF-8.".into()))?;
    let global = placement(input.env, agent, Component::Hook, Scope::Global, None)?;
    let (path, run): (PathBuf, PermissionPlanner) = match agent {
        Agent::Claude => (global, crate::setup::claude::plan),
        Agent::Codex => (
            global.with_file_name("config.toml"),
            crate::setup::codex::plan,
        ),
    };
    let index = match stages.load(&path) {
        Ok(index) => index,
        Err(conflict) => {
            plan.conflicts.push(conflict);
            return Ok(());
        }
    };
    match run(&path, stages.0[index].text.as_deref(), root) {
        Ok(planned) => {
            if let Some(text) = planned.text {
                stages.0[index].text = Some(text);
            }
            plan.permissions = planned.changes;
        }
        Err(error) if error.code() == "file_invalid" => {
            plan.conflicts
                .push(Conflict::new(ConflictKind::Invalid, &path, error.reason()));
        }
        Err(error) => plan
            .manual_steps
            .push(format!("{}: {}", path.display(), error.reason())),
    }
    Ok(())
}
