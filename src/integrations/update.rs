//! Planning `agboard update`: which recorded installations it may touch and
//! what it would change for each agent.
//!
//! Update keeps what connect recorded. It takes the Global records and the
//! Project records of the nearest bound root, nothing else, and plans each
//! agent with the scopes already recorded and with no permission edits. A
//! recorded component that no longer sits where the configuration places it,
//! or that is newer than this build, stops that agent instead of being moved
//! or downgraded.

use std::cmp::Ordering;
use std::path::Path;

use super::assets::EmbeddedBundle;
use super::compose::{plan_hook, plan_skill};
use super::paths::{PathEnv, placement, resolve_links, resolve_targets};
use super::plan::{AgentPlan, OpKind, Payload, PlannedOp, Stages};
use super::registry::{InstallationRecord, Registry};
use super::template::template_groups;
use super::types::{Agent, Component, IntegrationError, Scope};

/// The recorded installations of one agent that update may change.
#[derive(Debug, Clone)]
pub struct AgentRecords {
    pub agent: Agent,
    pub skill: Vec<InstallationRecord>,
    pub hook: Vec<InstallationRecord>,
}

impl AgentRecords {
    pub fn all(&self) -> impl Iterator<Item = &InstallationRecord> {
        self.skill.iter().chain(self.hook.iter())
    }
}

/// Whether update may touch `record`: it is Global, or it belongs to the
/// current nearest bound root.
pub fn in_reach(record: &InstallationRecord, root: Option<&Path>) -> bool {
    match record.scope {
        Scope::Global => true,
        Scope::Project => root.is_some_and(|r| record.bound_root.as_deref() == Some(r)),
    }
}

/// The records update may touch, grouped by agent in the order Claude Code
/// first. Agents without such a record are left out.
pub fn select(registry: &Registry, root: Option<&Path>) -> Vec<AgentRecords> {
    Agent::ALL
        .into_iter()
        .filter_map(|agent| {
            let of = |component: Component| -> Vec<InstallationRecord> {
                registry
                    .installations
                    .iter()
                    .filter(|r| r.agent == agent && r.component == component && in_reach(r, root))
                    .cloned()
                    .collect()
            };
            let records = AgentRecords {
                agent,
                skill: of(Component::Skill),
                hook: of(Component::Hook),
            };
            let any = records.all().next().is_some();
            any.then_some(records)
        })
        .collect()
}

/// Compares `1.2.3` style versions. A pre-release sorts before its release.
/// `None` when either side is not a dotted number.
pub fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
    fn parse(v: &str) -> Option<([u64; 3], bool)> {
        let v = v.split('+').next().unwrap_or(v);
        let (core, pre) = match v.split_once('-') {
            Some((core, _)) => (core, true),
            None => (v, false),
        };
        let mut numbers = [0u64; 3];
        let parts: Vec<&str> = core.split('.').collect();
        if parts.is_empty() || parts.len() > 3 {
            return None;
        }
        for (slot, part) in numbers.iter_mut().zip(parts) {
            *slot = part.parse().ok()?;
        }
        Some((numbers, !pre))
    }
    Some(parse(a)?.cmp(&parse(b)?))
}

/// What planning one agent produced, or why it cannot be planned.
pub struct UpdateInput<'a> {
    pub env: &'a PathEnv,
    pub bundle: &'a EmbeddedBundle,
    /// The nearest binding, when the folder is bound.
    pub project_id: Option<&'a str>,
    pub root: Option<&'a Path>,
    /// The whole registry: every root's managed entries count as managed.
    pub registry: &'a Registry,
}

/// Plans update for one agent without writing. `Err` is a reason that stops
/// this agent (it is reported and the exit code is 1). Each recorded scope is
/// planned on its own: the Global record and this root's Project record are
/// both updated, and a record is never moved to another scope.
pub fn plan_update(input: &UpdateInput, records: &AgentRecords) -> Result<AgentPlan, String> {
    let agent = records.agent;
    let scopes: Vec<Scope> = [Scope::Global, Scope::Project]
        .into_iter()
        .filter(|scope| records.all().any(|r| r.scope == *scope))
        .collect();
    for list in [&records.skill, &records.hook] {
        for scope in &scopes {
            if list.iter().filter(|r| r.scope == *scope).count() > 1 {
                return Err(format!(
                    "{} is recorded in more than one place. Run agboard connect to settle it.",
                    list[0].component.key()
                ));
            }
        }
    }
    for record in records.all() {
        check_record(input, record)?;
    }
    let first = scopes.first().copied().unwrap_or(Scope::Global);
    let targets =
        resolve_targets(input.env, agent, first, first, input.root).map_err(|e| e.to_string())?;
    let mut plan = AgentPlan {
        agent,
        targets,
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
    for scope in scopes {
        let targets = resolve_targets(input.env, agent, scope, scope, input.root)
            .map_err(|e| e.to_string())?;
        // The whole registry is read, so that another root's managed entries
        // are never reported as unmanaged; only the records of this scope
        // are planned, and nothing is moved.
        let plan_input = super::plan::PlanInput {
            env: input.env,
            targets: &targets,
            project_id: input.project_id,
            scan_root: input.root,
            registry: input.registry,
            bundle: input.bundle,
            permissions: false,
            moves: false,
        };
        let planned = (|| -> Result<(), IntegrationError> {
            if records.hook.iter().any(|r| r.scope == scope) {
                let template = template_groups(input.bundle, agent)?;
                plan_hook(&plan_input, &template, &mut stages, &mut plan)?;
            }
            if records.skill.iter().any(|r| r.scope == scope) {
                plan_skill(&plan_input, &mut plan)?;
            }
            Ok(())
        })();
        planned.map_err(|e| e.to_string())?;
    }
    if !plan.conflicts.is_empty() {
        plan.registry_changes.clear();
        plan.ops.clear();
        return Ok(plan);
    }
    let mut file_ops: Vec<PlannedOp> = stages
        .0
        .into_iter()
        .filter(|s| {
            s.text.is_some() && s.text.as_deref().map(str::as_bytes) != s.original.as_deref()
        })
        .map(|s| {
            let bytes = s.text.unwrap_or_default().into_bytes();
            PlannedOp {
                kind: OpKind::File,
                description: format!("update {}", s.path.display()),
                original_hash: s.original.as_deref().map(super::assets::sha256_hex),
                planned_hash: Some(super::assets::sha256_hex(&bytes)),
                payload: Payload::File(bytes),
                path: s.path,
            }
        })
        .collect();
    file_ops.append(&mut plan.ops);
    plan.ops = file_ops;
    Ok(plan)
}

/// The record must sit where the configuration places it now and must not be
/// newer than this build.
fn check_record(input: &UpdateInput, record: &InstallationRecord) -> Result<(), String> {
    let label = format!("{} {}", record.agent.label(), record.component.key());
    if compare_versions(&record.installed_version, input.bundle.version) == Some(Ordering::Greater)
    {
        return Err(format!(
            "{label} was installed by Agent Board {}, which is newer than this {}. Update never downgrades; run agboard connect to install this version on purpose.",
            record.installed_version, input.bundle.version
        ));
    }
    let now = placement(
        input.env,
        record.agent,
        record.component,
        record.scope,
        input.root,
    )
    .map_err(|e| e.to_string())?;
    if resolve_links(&now) != resolve_links(&record.resolved_path) {
        return Err(format!(
            "{label} is recorded at {}, but the configuration now places it at {}. Run agboard connect to settle it.",
            record.resolved_path.display(),
            now.display()
        ));
    }
    Ok(())
}
