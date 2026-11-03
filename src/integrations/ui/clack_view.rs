//! What connect and update show on a terminal, in cliclack's blocks: one
//! note per agent for the plan, red lines for what cannot be applied, yellow
//! for warnings, green for what was done. The wording follows the plain
//! reports in `report` and `update_report`.

use std::path::Path;

use crate::integrations::apply::{AgentOutcome, Status};
use crate::integrations::plan::{AgentPlan, PlanState};
use crate::integrations::registry::InstallationRecord;
use crate::integrations::report::{failure, next_step, scope_word};
use crate::integrations::types::Component;
use crate::integrations::update_report::{changes_hook, failure as update_failure};

pub const BACKUPS: &str = "Backups: each existing file that changes is first copied next to it (name.agboard-backup-...), and a Skill folder that changes is moved to .agboard-backups beside the skills folder. The copies are kept.";

/// `text` with every path under `home` written from `~`.
pub fn tilde(text: &str, home: Option<&Path>) -> String {
    let Some(home) = home
        .map(|h| h.display().to_string())
        .filter(|h| h.len() > 1)
    else {
        return text.to_string();
    };
    let home = home.trim_end_matches('/');
    text.replace(&format!("{home}/"), "~/")
        .replace(&format!("{home} "), "~ ")
}

type Short<'a> = &'a dyn Fn(&str) -> String;

fn placement(plan: &AgentPlan, short: Short) -> Vec<String> {
    let t = &plan.targets;
    vec![
        format!(
            "Skill  {:<8}{}",
            scope_word(t.skill_scope),
            short(&t.effective_paths.skill.display().to_string())
        ),
        format!(
            "Hook   {:<8}{}",
            scope_word(t.hook_scope),
            short(&t.effective_paths.hook.display().to_string())
        ),
    ]
}

/// The reasons an agent is left unchanged, and the line that says what to do.
fn blocked(plan: &AgentPlan, what: &str, command: &str, short: Short) {
    let mut lines = vec![format!(
        "{} cannot be {what}; nothing will change for it.",
        plan.agent.label()
    )];
    for c in &plan.conflicts {
        lines.push(format!(
            "  {}: {}",
            short(&c.path.display().to_string()),
            c.detail
        ));
    }
    for step in &plan.manual_steps {
        lines.push(format!("  {}", short(step)));
    }
    lines.push(format!(
        "Fix the items above, then run agboard {command} again."
    ));
    let _ = cliclack::log::error(lines.join("\n"));
}

fn warnings(plan: &AgentPlan, short: Short) {
    for warning in &plan.warnings {
        let _ = cliclack::log::warning(format!("Warning: {}", short(warning)));
    }
}

fn state_word(plan: &AgentPlan) -> &'static str {
    match plan.state() {
        PlanState::Ready => "changes",
        PlanState::Unchanged => "no changes",
        PlanState::Blocked => "cannot be applied",
    }
}

pub fn connect_plan(plans: &[AgentPlan], short: Short, command: &str) {
    for plan in plans {
        let mut lines = placement(plan, short);
        match plan.state() {
            PlanState::Unchanged => lines.push("Already set up as selected.".into()),
            PlanState::Ready => {
                lines.extend(plan.ops.iter().map(|op| short(&op.description)));
                let extra = plan
                    .additions
                    .iter()
                    .filter(|a| !plan.ops.iter().any(|op| &op.description == *a));
                lines.extend(extra.map(|a| format!("Add or update: {}", short(a))));
                lines.extend(
                    plan.removals
                        .iter()
                        .map(|r| format!("Remove: {}", short(r))),
                );
                lines.extend(
                    plan.permissions
                        .iter()
                        .map(|p| format!("Permissions: {}", short(p))),
                );
            }
            PlanState::Blocked => {}
        }
        let _ = cliclack::note(
            format!("{} · {}", plan.agent.label(), state_word(plan)),
            lines.join("\n"),
        );
        if plan.state() == PlanState::Blocked {
            blocked(plan, "set up", command, short);
        }
        warnings(plan, short);
    }
    if plans.iter().any(|plan| plan.state() == PlanState::Ready) {
        let _ = cliclack::log::remark(BACKUPS);
    }
}

pub fn connect_results(outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32, short: Short) {
    for outcome in outcomes {
        let label = outcome.agent.label();
        let plan = plans.iter().find(|p| p.agent == outcome.agent);
        let mut lines = Vec::new();
        match outcome.status {
            Status::Applied => {
                lines.push(format!("{label}: configured."));
                if let Some(plan) = plan {
                    lines.extend(placement(plan, short));
                    lines.extend(
                        plan.manual_steps
                            .iter()
                            .map(|s| format!("Do this yourself: {}", short(s))),
                    );
                }
                lines.extend(
                    outcome
                        .backups
                        .iter()
                        .map(|b| format!("Backup: {}", short(&b.display().to_string()))),
                );
                lines.push(format!("Next: {}", next_step(outcome.agent)));
                let _ = cliclack::log::success(lines.join("\n"));
            }
            Status::Unchanged => {
                let _ = cliclack::log::success(format!(
                    "{label}: already configured. No changes were needed."
                ));
            }
            Status::Blocked => {
                lines.push(format!("{label}: not configured; nothing was changed."));
                lines.extend(
                    outcome.conflicts.iter().map(|c| {
                        format!("  {}: {}", short(&c.path.display().to_string()), c.detail)
                    }),
                );
                lines.extend(
                    outcome
                        .manual_steps
                        .iter()
                        .map(|s| format!("  Do this yourself: {}", short(s))),
                );
                let _ = cliclack::log::error(lines.join("\n"));
            }
            Status::Failed | Status::Interrupted => {
                let mut text = String::new();
                failure(&mut text, outcome);
                let _ = cliclack::log::error(short(&text));
            }
        }
    }
    if outcomes.iter().any(|o| o.status == Status::Applied) {
        let _ = cliclack::log::remark(
            "Configured means the files are written and recorded. It does not show that an agent is running or has loaded them.",
        );
    }
    finish(exit, "Setup finished.", "Setup finished with errors.");
}

pub fn update_plan(plan: &AgentPlan, records: &[InstallationRecord], short: Short, command: &str) {
    let new_version = env!("CARGO_PKG_VERSION");
    let mut lines = Vec::new();
    for (name, component) in [("Skill", Component::Skill), ("Hook", Component::Hook)] {
        for r in records.iter().filter(|r| r.component == component) {
            lines.push(format!(
                "{name:<6} {:<8}{} → {new_version}",
                r.scope.key(),
                r.installed_version
            ));
        }
    }
    match plan.state() {
        PlanState::Unchanged => lines.push("Already up to date.".into()),
        PlanState::Ready => {
            lines.extend(plan.ops.iter().map(|op| short(&op.description)));
            if plan.ops.is_empty() {
                lines.push("Only the version in the installation record changes.".into());
            }
        }
        PlanState::Blocked => {}
    }
    let _ = cliclack::note(
        format!("{} · {}", plan.agent.label(), state_word(plan)),
        lines.join("\n"),
    );
    if plan.state() == PlanState::Ready && changes_hook(plan) {
        let _ = cliclack::log::warning(
            "The Hook changes: the agent must trust the changed Hook again.",
        );
    }
    if plan.state() == PlanState::Blocked {
        blocked(plan, "updated", command, short);
    }
    warnings(plan, short);
}

pub fn update_results(outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32, short: Short) {
    for outcome in outcomes {
        let label = outcome.agent.label();
        let plan = plans.iter().find(|p| p.agent == outcome.agent);
        match outcome.status {
            Status::Applied => {
                let mut lines = vec![format!("{label}: updated.")];
                lines.extend(
                    outcome
                        .backups
                        .iter()
                        .map(|b| format!("Backup: {}", short(&b.display().to_string()))),
                );
                if plan.is_some_and(changes_hook) {
                    lines.push(format!(
                        "Next: review the changed Hook with /hooks and trust it again in {label}."
                    ));
                }
                let _ = cliclack::log::success(lines.join("\n"));
            }
            Status::Unchanged => {
                let _ = cliclack::log::success(format!("{label}: already up to date."));
            }
            Status::Blocked => {
                let mut lines = vec![format!("{label}: not updated; nothing was changed.")];
                lines.extend(
                    outcome.conflicts.iter().map(|c| {
                        format!("  {}: {}", short(&c.path.display().to_string()), c.detail)
                    }),
                );
                lines.extend(
                    outcome
                        .manual_steps
                        .iter()
                        .map(|s| format!("  Do this yourself: {}", short(s))),
                );
                let _ = cliclack::log::error(lines.join("\n"));
            }
            Status::Failed | Status::Interrupted => {
                let mut text = String::new();
                update_failure(&mut text, outcome);
                let _ = cliclack::log::error(short(&text));
            }
        }
    }
    finish(exit, "Update finished.", "Update finished with errors.");
}

fn finish(exit: i32, done: &str, failed: &str) {
    let _ = if exit == 0 {
        cliclack::outro(done)
    } else {
        cliclack::outro_cancel(failed)
    };
}
