//! Planning the Hook and the Skill of one agent: merge into the target file,
//! find the registrations a scope move takes over, and decide the registry
//! records. Called by [`super::plan::plan_agent`].

use std::path::PathBuf;

use super::assets::hook_manifest_hash;
use super::duplicates::{check_other_registrations, is_move_source};
use super::merge::{HookEdit, merge_hooks, remove_hooks};
use super::paths::{placement, resolve_links};
use super::plan::{AgentPlan, PlanInput, RegistryChange, Stage, Stages};
use super::registry::InstallationRecord;
use super::skill::{SkillPlan, plan_install, plan_removal};
use super::template::TemplateGroup;
use super::types::{Component, IntegrationError, Scope};

pub(super) fn plan_hook(
    input: &PlanInput,
    template: &[TemplateGroup],
    stages: &mut Stages,
    plan: &mut AgentPlan,
) -> Result<(), IntegrationError> {
    let t = input.targets;
    let target = &t.effective_paths.hook;
    let resolved = resolve_links(target);
    let record = input.registry.installations.iter().find(|r| {
        r.agent == t.agent
            && r.component == Component::Hook
            && resolve_links(&r.resolved_path) == resolved
    });
    let recorded = record
        .map(|r| r.managed_entries.clone())
        .unwrap_or_default();
    let index = match stages.load(target) {
        Ok(index) => index,
        Err(conflict) => {
            plan.conflicts.push(conflict);
            return Ok(());
        }
    };
    let edit = merge_hooks(target, stages.0[index].text.as_deref(), template, &recorded);
    absorb(edit, &mut stages.0[index], plan, true);
    let check = check_other_registrations(
        input.env,
        t.agent,
        target,
        t.hook_scope,
        input.scan_root,
        input.registry,
        template,
    );
    plan.conflicts.extend(check.conflicts);
    plan.warnings.extend(check.warnings);
    for source in &check.sources {
        match stages.load(&source.resolved_path) {
            Ok(i) => {
                let edit = remove_hooks(
                    &source.resolved_path,
                    stages.0[i].text.as_deref(),
                    &source.managed_entries,
                );
                absorb(edit, &mut stages.0[i], plan, false);
            }
            Err(conflict) => plan.conflicts.push(conflict),
        }
        plan.registry_changes.push(remove_change(source));
    }
    let entries: Vec<_> = template.iter().map(|g| g.entry.clone()).collect();
    let new = InstallationRecord {
        agent: t.agent,
        component: Component::Hook,
        scope: t.hook_scope,
        project_id: project_of(input, t.hook_scope)?,
        bound_root: root_of(input, t.hook_scope),
        configured_path: target.clone(),
        resolved_path: resolved,
        installed_version: input.bundle.version.to_owned(),
        managed_hash: hook_manifest_hash(&entries),
        managed_entries: entries,
        files: Vec::new(),
    };
    if record != Some(&new) {
        plan.registry_changes.push(RegistryChange::Upsert(new));
    }
    Ok(())
}

pub(super) fn plan_skill(input: &PlanInput, plan: &mut AgentPlan) -> Result<(), IntegrationError> {
    let t = input.targets;
    let dir = &t.effective_paths.skill;
    let resolved = resolve_links(dir);
    let skills = || {
        input
            .registry
            .installations
            .iter()
            .filter(|r| r.agent == t.agent && r.component == Component::Skill)
    };
    let record = skills().find(|r| resolve_links(&r.resolved_path) == resolved);
    let SkillPlan {
        op,
        files,
        manifest_hash,
        conflicts,
    } = plan_install(dir, record, input.bundle);
    plan.conflicts.extend(conflicts);
    if let Some(op) = op {
        plan.additions.push(op.description.clone());
        plan.ops.push(op);
    }
    let others = skills().filter(|r| resolve_links(&r.resolved_path) != resolved);
    for kept in others
        .clone()
        .filter(|r| !is_move_source(r, t.skill_scope, input.scan_root))
    {
        if t.skill_scope == Scope::Global {
            plan.warnings.push(format!("Another project has its own Skill at {}. In that project the agent loads both it and the Global Skill.", kept.resolved_path.display()));
        }
    }
    for source in others.filter(|r| is_move_source(r, t.skill_scope, input.scan_root)) {
        let removal = plan_removal(&source.resolved_path, source);
        plan.conflicts.extend(removal.conflicts);
        if let Some(op) = removal.op {
            plan.removals.push(op.description.clone());
            plan.ops.push(op);
        }
        plan.registry_changes.push(remove_change(source));
    }
    let other = if t.skill_scope == Scope::Global {
        Scope::Project
    } else {
        Scope::Global
    };
    if let Ok(path) = placement(input.env, t.agent, Component::Skill, other, input.scan_root) {
        let known = skills().any(|r| resolve_links(&r.resolved_path) == resolve_links(&path));
        if path.exists() && !known {
            plan.warnings.push(format!("Another Skill named agent-board exists at {}. The agent may load it instead of the one connect installs.", path.display()));
        }
    }
    let new = InstallationRecord {
        agent: t.agent,
        component: Component::Skill,
        scope: t.skill_scope,
        project_id: project_of(input, t.skill_scope)?,
        bound_root: root_of(input, t.skill_scope),
        configured_path: dir.clone(),
        resolved_path: resolved,
        installed_version: input.bundle.version.to_owned(),
        managed_hash: manifest_hash,
        managed_entries: Vec::new(),
        files,
    };
    if record != Some(&new) {
        plan.registry_changes.push(RegistryChange::Upsert(new));
    }
    Ok(())
}

/// Takes the result of one hook edit into the plan.
fn absorb(edit: HookEdit, stage: &mut Stage, plan: &mut AgentPlan, adding: bool) {
    plan.conflicts.extend(edit.conflicts);
    if let Some(text) = edit.text {
        stage.text = Some(text);
    }
    let path = stage.path.display();
    let describe = |list: Vec<String>| {
        list.into_iter()
            .map(|item| format!("{item} in {path}"))
            .collect::<Vec<_>>()
    };
    if adding {
        plan.additions.extend(describe(edit.added));
    }
    plan.removals.extend(describe(edit.removed));
}

fn remove_change(record: &InstallationRecord) -> RegistryChange {
    RegistryChange::Remove {
        agent: record.agent,
        component: record.component,
        scope: record.scope,
        bound_root: record.bound_root.clone(),
    }
}

fn project_of(input: &PlanInput, scope: Scope) -> Result<Option<String>, IntegrationError> {
    match scope {
        Scope::Global => Ok(None),
        Scope::Project => input
            .project_id
            .map(|id| Some(id.to_owned()))
            .ok_or(IntegrationError::BindingRequired),
    }
}

fn root_of(input: &PlanInput, scope: Scope) -> Option<PathBuf> {
    (scope == Scope::Project)
        .then(|| input.targets.bound_root.clone())
        .flatten()
}
