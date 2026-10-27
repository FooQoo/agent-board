//! Applying planned changes. Each agent is one transaction: lock, re-check
//! every target against the plan, write the journal, back up and replace each
//! target atomically, then commit the registry. Any failure undoes what that
//! agent's run changed, and never another agent's finished installation. The
//! agents run one after the other, Claude Code first, independently.

use std::fs;

use super::journal::{
    AgentLock, Journal, JournalOp, journal_path, read_journal, state_hash, write_journal,
};
use super::ops::{
    build_tree, journal_op, prune_backup_dir, registry_op, unique_id, write_new_file,
};
use super::outcome::{Abort, notify};
pub use super::outcome::{
    AgentOutcome, ApplyOptions, Observer, Phase, Status, Step, StepAction, exit_code, is_partial,
};
use super::paths::{PathEnv, data_dir, registry_path};
use super::plan::{AgentPlan, OpKind, Payload, PlanState, PlannedOp};
use super::recovery::rollback;
use crate::setup::apply::{NEW_FILE_MODE, file_mode, write_atomically};

/// Applies every plan, Claude Code first. A failed or blocked agent does not
/// stop the next one and does not undo the previous one.
pub fn apply_all(env: &PathEnv, plans: &[AgentPlan], options: &ApplyOptions) -> Vec<AgentOutcome> {
    let mut ordered: Vec<&AgentPlan> = plans.iter().collect();
    ordered.sort_by_key(|p| p.agent);
    ordered
        .into_iter()
        .map(|plan| apply_agent(env, plan, options))
        .collect()
}

/// Applies one agent's plan as one transaction.
pub fn apply_agent(env: &PathEnv, plan: &AgentPlan, options: &ApplyOptions) -> AgentOutcome {
    let agent = plan.agent;
    match plan.state() {
        PlanState::Blocked => AgentOutcome {
            conflicts: plan.conflicts.clone(),
            manual_steps: plan.manual_steps.clone(),
            ..AgentOutcome::new(agent, Status::Blocked)
        },
        PlanState::Unchanged => AgentOutcome::new(agent, Status::Unchanged),
        PlanState::Ready => {
            run(env, plan, options).unwrap_or_else(|message| AgentOutcome::failed(agent, message))
        }
    }
}

fn run(env: &PathEnv, plan: &AgentPlan, options: &ApplyOptions) -> Result<AgentOutcome, String> {
    let agent = plan.agent;
    let observer = options.observer;
    let data = data_dir(env).map_err(|e| e.to_string())?;
    let _lock = AgentLock::acquire(&data, agent)?;
    if read_journal(&data, agent)?.is_some() {
        return Err(format!(
            "an earlier run did not finish; recover it first ({}).",
            journal_path(&data, agent).display()
        ));
    }
    let registry_file = registry_path(env).map_err(|e| e.to_string())?;
    let mut ops: Vec<PlannedOp> = plan.ops.clone();
    if let Some(op) = registry_op(&registry_file, &plan.registry_changes)? {
        ops.push(op);
    }
    for op in &ops {
        let now = state_hash(op.kind, &op.path)?;
        if now != op.original_hash {
            return Err(format!(
                "{} changed after the plan was made; nothing was overwritten. Run the command again.",
                op.path.display()
            ));
        }
    }
    let txn = unique_id();
    let journal = Journal {
        version: 1,
        agent,
        txn: txn.clone(),
        ops: ops
            .iter()
            .enumerate()
            .map(|(i, op)| journal_op(op, &txn, i))
            .collect(),
    };
    write_journal(&data, &journal)?;
    let mut began = 0;
    for (index, op) in ops.iter().enumerate() {
        let is_registry = index + 1 == ops.len() && op.path == registry_file;
        if let Err(abort) = apply_op(
            index,
            op,
            &journal.ops[index],
            is_registry,
            &mut began,
            observer,
        ) {
            return Ok(match abort {
                Abort::Crash(reason) => AgentOutcome {
                    message: Some(reason),
                    ..AgentOutcome::new(agent, Status::Interrupted)
                },
                Abort::Fail(reason) => {
                    let report = rollback(&data, &journal, began, observer);
                    let tail = if !report.is_clean() {
                        "Some changes could not be restored; see the recovery paths."
                    } else if report.external.is_empty() {
                        "Everything this run changed for the agent was restored."
                    } else {
                        "The rest was restored; files someone else changed were left as they are, and their backups are named below."
                    };
                    AgentOutcome {
                        rollback: Some(report),
                        message: Some(format!("{reason}. {tail}")),
                        ..AgentOutcome::new(agent, Status::Failed)
                    }
                }
            });
        }
    }
    super::journal::remove_journal(&data, agent);
    for stage in journal.ops.iter().filter_map(|j| j.stage.as_deref()) {
        prune_backup_dir(stage);
    }
    let backups = journal
        .ops
        .iter()
        .filter_map(|j| j.backup.clone())
        .filter(|b| b.exists())
        .collect();
    Ok(AgentOutcome {
        changes: ops.iter().map(|o| o.description.clone()).collect(),
        backups,
        ..AgentOutcome::new(agent, Status::Applied)
    })
}

fn apply_op(
    index: usize,
    op: &PlannedOp,
    journal: &JournalOp,
    is_registry: bool,
    began: &mut usize,
    observer: Option<Observer>,
) -> Result<(), Abort> {
    let fail = |e: std::io::Error| Abort::Fail(format!("{}: {e}", op.path.display()));
    notify(observer, Phase::Backup, index, &op.path)?;
    recheck(op)?;
    if let (OpKind::File, Some(backup)) = (op.kind, &journal.backup) {
        let bytes = fs::read(&op.path).map_err(fail)?;
        write_new_file(backup, &bytes, file_mode(&op.path).unwrap_or(NEW_FILE_MODE))
            .map_err(fail)?;
    }
    if let (Payload::Tree(files), Some(stage)) = (&op.payload, &journal.stage) {
        if let Some(parent) = stage.parent() {
            fs::create_dir_all(parent).map_err(fail)?;
        }
        build_tree(stage, files).map_err(fail)?;
    }
    *began = index + 1;
    notify(
        observer,
        if is_registry {
            Phase::Registry
        } else {
            Phase::Rename
        },
        index,
        &op.path,
    )?;
    recheck(op)?;
    match (&op.payload, &journal.backup, &journal.stage) {
        (Payload::File(bytes), _, _) => {
            if let Some(parent) = op.path.parent() {
                fs::create_dir_all(parent).map_err(fail)?;
            }
            write_atomically(
                &op.path,
                bytes,
                file_mode(&op.path).unwrap_or(NEW_FILE_MODE),
            )
            .map_err(fail)
        }
        (Payload::Tree(_), backup, Some(stage)) => {
            if let Some(parent) = op.path.parent() {
                fs::create_dir_all(parent).map_err(fail)?;
            }
            if let Some(backup) = backup {
                if let Some(parent) = backup.parent() {
                    fs::create_dir_all(parent).map_err(fail)?;
                }
                fs::rename(&op.path, backup).map_err(fail)?;
            }
            fs::rename(stage, &op.path).map_err(fail)
        }
        (Payload::Remove, Some(backup), _) => {
            if let Some(parent) = backup.parent() {
                fs::create_dir_all(parent).map_err(fail)?;
            }
            fs::rename(&op.path, backup).map_err(fail)
        }
        _ => Err(Abort::Fail(format!(
            "{}: the plan is inconsistent",
            op.path.display()
        ))),
    }
}

/// Fails when the target no longer has the state the plan was made from.
fn recheck(op: &PlannedOp) -> Result<(), Abort> {
    match state_hash(op.kind, &op.path) {
        Ok(now) if now == op.original_hash => Ok(()),
        Ok(_) => Err(Abort::Fail(format!(
            "{} changed while the run was in progress; it was not overwritten",
            op.path.display()
        ))),
        Err(reason) => Err(Abort::Fail(reason)),
    }
}
