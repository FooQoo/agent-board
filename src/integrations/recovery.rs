//! Undoing an agent's transaction that did not finish. The same code serves
//! the rollback after a failed run and the recovery of a run that died: for
//! each touched file or directory, newest first, it compares the state on
//! disk with the journal.
//!
//! - the original state: nothing to undo;
//! - the planned state: put the backup back (or remove what the run created);
//! - a Skill directory that is gone while its backup holds the original: the
//!   run died between its two renames, so rename the backup back;
//! - anything else: someone else changed it. It is left as it is, and the
//!   report names the backup.
//!
//! Only the connect and update commands recover. Ordinary commands and Hooks
//! never read the journal and never write settings.

use std::fs;
use std::path::{Path, PathBuf};

use super::journal::{AgentLock, Journal, JournalOp, read_journal, remove_journal, state_hash};
use super::outcome::{Abort, Observer, Phase, notify};
use super::paths::{PathEnv, data_dir};
use super::plan::OpKind;
use super::types::{Agent, IntegrationError};
use crate::setup::apply::{NEW_FILE_MODE, file_mode, write_atomically};

/// What happened to one touched path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpRestore {
    Untouched,
    Restored,
    /// Changed by someone else; left alone.
    External,
    /// The undo itself failed; the journal stays.
    Stuck(String),
}

/// The result of one rollback or recovery.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RecoveryReport {
    pub restored: Vec<PathBuf>,
    /// Changed by someone else; left alone. The backup, if any, is named.
    pub external: Vec<(PathBuf, Option<PathBuf>)>,
    /// Could not be undone: path, reason, backup.
    pub stuck: Vec<(PathBuf, String, Option<PathBuf>)>,
    pub journal: Option<PathBuf>,
    /// Recovery of an earlier run: a path someone else changed also keeps the
    /// journal, so the user decides what to do with it.
    pub keep_on_external: bool,
}

impl RecoveryReport {
    /// Whether the journal could be closed.
    pub fn is_clean(&self) -> bool {
        self.stuck.is_empty() && (!self.keep_on_external || self.external.is_empty())
    }
}

/// Undoes `journal.ops[..began]` (newest first) and cleans up. Operations at
/// `began` and later never started: only their leftovers are removed.
pub fn rollback(
    data_dir: &Path,
    journal: &Journal,
    began: usize,
    observer: Option<Observer>,
) -> RecoveryReport {
    undo(data_dir, journal, began, observer, false)
}

fn undo(
    data_dir: &Path,
    journal: &Journal,
    began: usize,
    observer: Option<Observer>,
    keep_on_external: bool,
) -> RecoveryReport {
    let mut report = RecoveryReport {
        journal: Some(super::journal::journal_path(data_dir, journal.agent)),
        keep_on_external,
        ..RecoveryReport::default()
    };
    let mut results: Vec<(usize, OpRestore)> = Vec::new();
    for (index, op) in journal.ops.iter().enumerate().rev() {
        let outcome = if index >= began {
            OpRestore::Untouched
        } else {
            match notify(observer, Phase::Recovery, index, &op.path) {
                Ok(()) => restore_op(op),
                Err(Abort::Fail(reason) | Abort::Crash(reason)) => OpRestore::Stuck(reason),
            }
        };
        match &outcome {
            OpRestore::Restored => report.restored.push(op.path.clone()),
            OpRestore::External => report.external.push((op.path.clone(), op.backup.clone())),
            OpRestore::Stuck(reason) => {
                report
                    .stuck
                    .push((op.path.clone(), reason.clone(), op.backup.clone()))
            }
            OpRestore::Untouched => {}
        }
        results.push((index, outcome));
    }
    if report.is_clean() {
        for (index, outcome) in results {
            let op = &journal.ops[index];
            if let Some(stage) = &op.stage {
                let _ = fs::remove_dir_all(stage);
            }
            let keep = outcome == OpRestore::External || op.kind != OpKind::File;
            if let (false, Some(backup)) = (keep, &op.backup) {
                let _ = fs::remove_file(backup);
            }
        }
        remove_journal(data_dir, journal.agent);
    }
    report
}

/// Undoes one operation if it is safe to.
pub fn restore_op(op: &JournalOp) -> OpRestore {
    let current = match state_hash(op.kind, &op.path) {
        Ok(hash) => hash,
        Err(reason) => return OpRestore::Stuck(reason),
    };
    if current == op.original_hash {
        return OpRestore::Untouched;
    }
    let between_renames = op.kind == OpKind::Tree && current.is_none();
    if current == op.planned_hash || between_renames {
        return match put_back(op) {
            Ok(()) => OpRestore::Restored,
            Err(reason) => OpRestore::Stuck(reason),
        };
    }
    OpRestore::External
}

/// Restores the original from the backup, or removes what the run created.
fn put_back(op: &JournalOp) -> Result<(), String> {
    let gone = |error: std::io::Error| error.to_string();
    match (op.kind, &op.backup, &op.original_hash) {
        (OpKind::File, Some(backup), Some(hash)) => {
            let bytes = fs::read(backup)
                .map_err(|e| format!("the backup {} cannot be read: {e}", backup.display()))?;
            if &super::assets::sha256_hex(&bytes) != hash {
                return Err(format!(
                    "the backup {} does not hold the original",
                    backup.display()
                ));
            }
            let mode = file_mode(backup).unwrap_or(NEW_FILE_MODE);
            write_atomically(&op.path, &bytes, mode).map_err(gone)
        }
        (OpKind::File, None, None) => match fs::remove_file(&op.path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        },
        (OpKind::Tree, Some(backup), Some(hash)) => {
            if state_hash(OpKind::Tree, backup)?.as_deref() != Some(hash.as_str()) {
                return Err(format!(
                    "the backup {} does not hold the original",
                    backup.display()
                ));
            }
            if op.path.exists() {
                fs::remove_dir_all(&op.path).map_err(gone)?;
            }
            fs::rename(backup, &op.path).map_err(gone)
        }
        (OpKind::Tree, None, None) => match fs::remove_dir_all(&op.path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        },
        _ => Err("the journal is inconsistent".into()),
    }
}

/// Whether an unfinished transaction of `agent` is pending.
pub fn is_pending(env: &PathEnv, agent: Agent) -> Result<bool, IntegrationError> {
    let dir = data_dir(env)?;
    read_journal(&dir, agent)
        .map(|j| j.is_some())
        .map_err(IntegrationError::Board)
}

/// Finds and undoes the unfinished transaction of `agent`, if any. connect and
/// update call this before they plan. `Ok(None)` when nothing was pending.
/// When the report is not clean (a path could not be undone, or someone else
/// changed one) the journal stays, and the caller must stop and show the paths.
pub fn recover_pending(
    env: &PathEnv,
    agent: Agent,
    observer: Option<Observer>,
) -> Result<Option<RecoveryReport>, IntegrationError> {
    let dir = data_dir(env)?;
    // Without a journal file there is nothing to recover, and a run that only
    // plans or is cancelled must not create the lock file. When one exists,
    // the lock is taken before the journal is read, so that a run in progress
    // is never mistaken for a dead one.
    if !super::journal::journal_path(&dir, agent).exists() {
        return Ok(None);
    }
    let _lock = AgentLock::acquire(&dir, agent).map_err(IntegrationError::Board)?;
    let Some(journal) = read_journal(&dir, agent).map_err(IntegrationError::Board)? else {
        return Ok(None);
    };
    Ok(Some(undo(
        &dir,
        &journal,
        journal.ops.len(),
        observer,
        true,
    )))
}
