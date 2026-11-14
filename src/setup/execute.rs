//! Carrying out a plan. The settings files are written first, all or none.
//! Then each agent's plugin is installed with its own commands and, for
//! Codex, the plugin's hooks are trusted. A failure there stops only that
//! agent and is reported; the files already written stay, because they are
//! correct on their own and setup can be run again.

use std::fs;
use std::path::PathBuf;

use super::prepare::{AgentPlan, Prepared, plugin_line};
use super::report::{AgentReport, FileReport, SetupReport, Status};
use super::{apply, env, plugin, trust};
use crate::error::{AgboardError, FileAction};

/// Runs the plan, or reports it when the plan is a dry run.
pub fn execute(prepared: Prepared) -> Result<SetupReport, AgboardError> {
    let targets: Vec<_> = prepared
        .agents
        .iter()
        .filter(|plan| plan.active())
        .flat_map(|plan| plan.targets.iter().cloned())
        .collect();
    let mut backups = if prepared.dry_run {
        vec![None; targets.len()]
    } else {
        fs::create_dir_all(&prepared.shared_dir).map_err(|error| AgboardError::FileError {
            action: FileAction::Write,
            file: env::display(&prepared.shared_dir),
            reason: error.to_string(),
        })?;
        apply::apply(&targets)?
    }
    .into_iter();
    let work_dir = Some(prepared.data_dir.clone())
        .filter(|dir| dir.is_dir())
        .or_else(|| prepared.work_dir.clone());

    let mut agents = Vec::new();
    for plan in &prepared.agents {
        let files: Vec<FileReport> = if plan.active() {
            plan.targets
                .iter()
                .map(|target| FileReport {
                    path: target.config_path.clone(),
                    status: match (&target.planned, prepared.dry_run) {
                        (None, _) => Status::Unchanged,
                        (Some(_), true) => Status::Planned,
                        (Some(_), false) => Status::Updated,
                    },
                    changes: target.changes.clone(),
                    backup_path: backups.next().flatten(),
                })
                .collect()
        } else {
            Vec::new()
        };
        agents.push(run_agent(plan, files, prepared.dry_run, work_dir.as_ref()));
    }
    Ok(SetupReport {
        mode: prepared.mode,
        data_dir: prepared.data_dir,
        shared_dir: prepared.shared_dir,
        dry_run: prepared.dry_run,
        agents,
    })
}

fn run_agent(
    plan: &AgentPlan,
    files: Vec<FileReport>,
    dry_run: bool,
    work_dir: Option<&PathBuf>,
) -> AgentReport {
    let mut report = AgentReport {
        agent: plan.agent,
        status: Status::Unchanged,
        reason: None,
        source: plan.source.describe(),
        installed: plan.installed.clone(),
        plugin: plugin_line(plan),
        files,
        steps: Vec::new(),
        trusted_hooks: None,
        manual: plan.manual.clone(),
    };
    if let Some(reason) = &plan.skipped {
        report.status = Status::Skipped;
        report.reason = Some(reason.clone());
        return report;
    }
    if let Some(reason) = &plan.failed {
        report.status = Status::Failed;
        report.reason = Some(reason.clone());
        return report;
    }
    let files_changed = report.files.iter().any(|f| f.status != Status::Unchanged);
    if dry_run {
        if files_changed || plan.install || plan.trust {
            report.status = Status::Planned;
        }
        return report;
    }
    let Some(program) = &plan.program else {
        return report;
    };
    if plan.install {
        match plugin::install(plan.agent, program, &plan.source) {
            Ok(steps) => report.steps = steps,
            Err(reason) => return failed(report, reason),
        }
    }
    if plan.trust {
        let Some(cwd) = work_dir else {
            return failed(
                report,
                "No folder was found to run codex app-server in, so the hooks were not trusted."
                    .to_string(),
            );
        };
        report
            .steps
            .push("codex app-server (hooks/list, config/value/write)".to_string());
        match trust::trust_codex_hooks(program, cwd) {
            Ok(count) => report.trusted_hooks = Some(count),
            Err(reason) => return failed(report, reason),
        }
    }
    let trusted = report.trusted_hooks.unwrap_or(0) > 0;
    if files_changed || plan.install || trusted {
        report.status = Status::Updated;
    }
    report
}

fn failed(mut report: AgentReport, reason: String) -> AgentReport {
    report.status = Status::Failed;
    report.reason = Some(reason);
    report
}
