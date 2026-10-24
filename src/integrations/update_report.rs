//! The text `agboard update` shows: the diff before the question and the
//! result of each agent afterwards. Failure reasons are returned apart so
//! that the command can write them to standard error.

use std::fmt::Write as _;

use super::apply::{AgentOutcome, Status};
use super::paths::resolve_links;
use super::plan::{AgentPlan, OpKind, PlanState};
use super::registry::Registry;
use super::types::Component;

/// The diff shown before the question: one block per agent.
pub fn describe(plan: &AgentPlan, registry: &Registry) -> String {
    let mut text = format!("{}\n", plan.agent.label());
    let recorded = |component: Component| {
        registry.installations.iter().find(|r| {
            r.agent == plan.agent
                && r.component == component
                && r.resolved_path
                    == resolve_links(&match component {
                        Component::Skill => plan.targets.effective_paths.skill.clone(),
                        Component::Hook => plan.targets.effective_paths.hook.clone(),
                    })
        })
    };
    let new_version = env!("CARGO_PKG_VERSION");
    for (name, component) in [("Skill", Component::Skill), ("Hook", Component::Hook)] {
        if let Some(r) = recorded(component) {
            let _ = writeln!(
                text,
                "  {name} ({}): {} -> {new_version}",
                r.scope.key(),
                r.installed_version
            );
        }
    }
    match plan.state() {
        PlanState::Unchanged => text.push_str("  Already up to date.\n"),
        PlanState::Ready => {
            for op in &plan.ops {
                let _ = writeln!(text, "  {}", op.description);
            }
            if plan.ops.is_empty() {
                text.push_str("  Only the version in the installation record changes.\n");
            }
            if changes_hook(plan) {
                text.push_str("  The Hook changes: the agent must trust the changed Hook again.\n");
            }
        }
        PlanState::Blocked => {
            text.push_str("  Cannot be updated; nothing will change for this agent:\n");
            for c in &plan.conflicts {
                let _ = writeln!(text, "    {}: {}", c.path.display(), c.detail);
            }
            for step in &plan.manual_steps {
                let _ = writeln!(text, "    {step}");
            }
        }
    }
    for warning in &plan.warnings {
        let _ = writeln!(text, "  Warning: {warning}");
    }
    text
}

/// Update adds no permission edits, so a changed settings file is a changed
/// Hook.
fn changes_hook(plan: &AgentPlan) -> bool {
    plan.ops.iter().any(|op| op.kind == OpKind::File)
}

/// The result text and the failure reasons (standard error) of each agent.
pub fn results(outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) -> (String, String) {
    let mut shown = String::new();
    let mut errors = String::new();
    for outcome in outcomes {
        let label = outcome.agent.label();
        let plan = plans.iter().find(|p| p.agent == outcome.agent);
        match outcome.status {
            Status::Applied => {
                let _ = writeln!(shown, "{label}: updated.");
                for backup in &outcome.backups {
                    let _ = writeln!(shown, "  Backup: {}", backup.display());
                }
                if plan.is_some_and(changes_hook) {
                    let _ = writeln!(
                        shown,
                        "  Review the changed Hook with /hooks and trust it again in {label}."
                    );
                }
            }
            Status::Unchanged => {
                let _ = writeln!(shown, "{label}: already up to date.");
            }
            Status::Blocked => {
                let _ = writeln!(errors, "{label}: not updated; nothing was changed.");
                for c in &outcome.conflicts {
                    let _ = writeln!(errors, "  {}: {}", c.path.display(), c.detail);
                }
                for step in &outcome.manual_steps {
                    let _ = writeln!(errors, "  Do this yourself: {step}");
                }
            }
            Status::Failed | Status::Interrupted => {
                let mut one = String::new();
                failure(&mut one, outcome);
                errors.push_str(&one);
            }
        }
    }
    let line = if exit == 0 {
        "Update finished.\n"
    } else {
        "Update finished with errors.\n"
    };
    if exit == 0 {
        shown.push_str(line);
    } else {
        errors.push_str(line);
    }
    (shown, errors)
}

fn failure(text: &mut String, outcome: &AgentOutcome) {
    let _ = writeln!(
        text,
        "{}: not updated; {}",
        outcome.agent.label(),
        outcome.message.as_deref().unwrap_or("the change failed.")
    );
    if let Some(report) = &outcome.rollback {
        for (path, reason, _) in &report.stuck {
            let _ = writeln!(text, "  Could not restore {}: {reason}", path.display());
        }
        for (path, _) in &report.external {
            let _ = writeln!(
                text,
                "  Changed by someone else, left as it is: {}",
                path.display()
            );
        }
        if let Some(journal) = report.journal.as_ref().filter(|_| !report.is_clean()) {
            let _ = writeln!(
                text,
                "  Journal: {} (the next update or connect run recovers it)",
                journal.display()
            );
        }
    }
}
