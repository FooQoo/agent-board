//! The text connect shows: the plan before the question and the result of
//! each agent afterwards. English is the source wording. "Configured" means
//! the files were written and checked, not that an agent is running or has
//! loaded them.

use std::fmt::Write as _;
use std::path::Path;

use super::apply::{AgentOutcome, Status};
use super::plan::{AgentPlan, PlanState};
use super::recovery::RecoveryReport;
use super::types::{Agent, Scope};

fn scope_word(scope: Scope) -> &'static str {
    match scope {
        Scope::Global => "global",
        Scope::Project => "project",
    }
}

/// What is shown first: the project and the root that decides Project scope.
pub fn header(project: &str, root: &Path) -> String {
    format!("Project: {project}\nBound root: {}\n\n", root.display())
}

/// The plan of every selected agent, before the y/N question.
pub fn summary(plans: &[AgentPlan]) -> String {
    let mut text = String::from("\nPlanned changes\n");
    for plan in plans {
        let t = &plan.targets;
        let _ = write!(
            text,
            "\n{}\n  Skill ({}): {}\n  Hook ({}): {}\n",
            plan.agent.label(),
            scope_word(t.skill_scope),
            t.effective_paths.skill.display(),
            scope_word(t.hook_scope),
            t.effective_paths.hook.display(),
        );
        match plan.state() {
            PlanState::Unchanged => text.push_str("  No changes: already set up as selected.\n"),
            PlanState::Ready => {
                for op in &plan.ops {
                    let _ = writeln!(text, "  {}", op.description);
                }
                let extra: Vec<String> = plan
                    .additions
                    .iter()
                    .filter(|a| !plan.ops.iter().any(|op| &op.description == *a))
                    .cloned()
                    .collect();
                lines(&mut text, "Add or update", &extra);
                lines(&mut text, "Remove (scope move)", &plan.removals);
                lines(&mut text, "Permissions", &plan.permissions);
            }
            PlanState::Blocked => {
                text.push_str("  Cannot be applied; nothing will change for this agent:\n");
                for c in &plan.conflicts {
                    let _ = writeln!(text, "    {}: {}", c.path.display(), c.detail);
                }
                for step in &plan.manual_steps {
                    let _ = writeln!(text, "    {step}");
                }
            }
        }
        lines(&mut text, "Warning", &plan.warnings);
    }
    text.push_str(
        "\nBackups: every existing file or Skill folder that changes is first copied next to the original (name.agboard-backup-...) and the copy is kept.\n\n",
    );
    text
}

fn lines(text: &mut String, label: &str, items: &[String]) {
    for item in items {
        let _ = writeln!(text, "  {label}: {item}");
    }
}

/// What recovering an unfinished earlier run found. `None` when it is clean.
pub fn recovery(agent: Agent, report: &RecoveryReport) -> String {
    let mut text = String::new();
    if report.is_clean() {
        let _ = writeln!(
            text,
            "{}: an unfinished earlier run was found and undone ({} path(s) restored).",
            agent.label(),
            report.restored.len()
        );
        return text;
    }
    let _ = writeln!(
        text,
        "{}: an unfinished earlier run could not be undone safely. Nothing was planned for this agent.",
        agent.label()
    );
    for (path, reason, backup) in &report.stuck {
        let _ = writeln!(
            text,
            "  {}: {reason}{}",
            path.display(),
            backup_note(backup)
        );
    }
    for (path, backup) in &report.external {
        let _ = writeln!(
            text,
            "  {}: changed by someone else; left as it is{}",
            path.display(),
            backup_note(backup)
        );
    }
    if let Some(journal) = &report.journal {
        let _ = writeln!(text, "  Journal: {}", journal.display());
    }
    text.push_str("  Restore the files from the backups named above, remove the journal, then run connect again.\n");
    text
}

fn backup_note(backup: &Option<std::path::PathBuf>) -> String {
    backup
        .as_ref()
        .map(|b| format!(" (backup: {})", b.display()))
        .unwrap_or_default()
}

/// The result of every agent, ending with the overall line.
pub fn results(outcomes: &[AgentOutcome], plans: &[AgentPlan], exit: i32) -> String {
    let mut text = String::from("\n");
    for outcome in outcomes {
        let label = outcome.agent.label();
        let plan = plans.iter().find(|p| p.agent == outcome.agent);
        match outcome.status {
            Status::Applied => {
                let _ = writeln!(text, "{label}: configured. {}", next_step(outcome.agent));
                if let Some(plan) = plan {
                    placement(&mut text, plan);
                }
                for backup in &outcome.backups {
                    let _ = writeln!(text, "  Backup: {}", backup.display());
                }
            }
            Status::Unchanged => {
                let _ = writeln!(text, "{label}: already configured. No changes were needed.");
            }
            Status::Blocked => {
                let _ = writeln!(text, "{label}: not configured; nothing was changed.");
                for c in &outcome.conflicts {
                    let _ = writeln!(text, "  {}: {}", c.path.display(), c.detail);
                }
                for step in &outcome.manual_steps {
                    let _ = writeln!(text, "  Do this yourself: {step}");
                }
            }
            Status::Failed | Status::Interrupted => failure(&mut text, outcome),
        }
        if let Some(plan) = plan.filter(|_| outcome.status == Status::Applied) {
            for step in &plan.manual_steps {
                let _ = writeln!(text, "  Do this yourself: {step}");
            }
        }
    }
    if outcomes.iter().any(|o| o.status == Status::Applied) {
        text.push_str(
            "\nConfigured means the files are written and recorded. It does not show that an agent is running or has loaded them.\n",
        );
    }
    text.push_str(if exit == 0 {
        "Setup finished.\n"
    } else {
        "Setup finished with errors.\n"
    });
    text
}

fn placement(text: &mut String, plan: &AgentPlan) {
    let t = &plan.targets;
    let _ = writeln!(
        text,
        "  Skill ({}): {}\n  Hook ({}): {}",
        scope_word(t.skill_scope),
        t.effective_paths.skill.display(),
        scope_word(t.hook_scope),
        t.effective_paths.hook.display(),
    );
}

fn failure(text: &mut String, outcome: &AgentOutcome) {
    let label = outcome.agent.label();
    let what = if outcome.status == Status::Interrupted {
        "interrupted"
    } else {
        "not configured"
    };
    let _ = writeln!(
        text,
        "{label}: {what}; {}",
        outcome.message.as_deref().unwrap_or("the change failed.")
    );
    if let Some(report) = &outcome.rollback {
        for (path, reason, backup) in &report.stuck {
            let _ = writeln!(
                text,
                "  Could not restore {}: {reason}{}",
                path.display(),
                backup_note(backup)
            );
        }
        for (path, backup) in &report.external {
            let _ = writeln!(
                text,
                "  Changed by someone else, left as it is: {}{}",
                path.display(),
                backup_note(backup)
            );
        }
        if let Some(journal) = report.journal.as_ref().filter(|_| !report.is_clean()) {
            let _ = writeln!(
                text,
                "  Journal: {} (the next connect run recovers it)",
                journal.display()
            );
        }
    }
}

fn next_step(agent: Agent) -> &'static str {
    match agent {
        Agent::Claude => "Start a new session and review the hook with /hooks before you trust it.",
        Agent::Codex => "Restart Codex and review the hook with /hooks before you trust it.",
    }
}
