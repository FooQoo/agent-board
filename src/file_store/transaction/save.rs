//! Saving one task's pair through a journal.

use std::fs;
use std::path::Path;

use super::journal::{Journal, Phase, hashes, serialize};
use super::paths::{journal_dir, label, read_pair, validate_targets};
use super::recover::recover_locked;
use super::stage::{Fault, Stage, point, replace};
use super::{PairBytes, PairTargets};
use crate::error::AgboardError;
use crate::file_store::io::{random_hex, sync_dir, write_atomic, write_error};

/// Save an existing pair. `old` must still match the target files. This
/// function does not acquire the lock; doing so belongs to the calling store.
pub fn save_pair_locked(
    project: &Path,
    targets: &PairTargets,
    old: &PairBytes,
    new: &PairBytes,
) -> Result<(), AgboardError> {
    save_pair_with_hook_locked(project, targets, old, new, |_| Ok(()))
}

/// Test hook variant of save_pair_locked. Failures before the durable commit
/// restore old bytes; cleanup failures after commit are successful saves.
#[doc(hidden)]
pub fn save_pair_with_hook_locked(
    project: &Path,
    targets: &PairTargets,
    old: &PairBytes,
    new: &PairBytes,
    mut hook: impl FnMut(Stage) -> Result<(), Fault>,
) -> Result<(), AgboardError> {
    recover_locked(project)?;
    validate_targets(project, targets)?;
    let observed = read_pair(project, targets)?;
    if &observed != old {
        return Err(write_error(
            &label(&targets.metadata),
            "The pair changed before saving.",
        ));
    }
    if old == new {
        return Ok(());
    }
    let dir = journal_dir(project)?;
    fs::create_dir_all(&dir).map_err(|e| write_error(".internal/transactions", e))?;
    let path = dir.join(format!(
        "{}.json",
        random_hex(16).map_err(|e| write_error(".internal/transactions", e))?
    ));
    let mut journal = Journal {
        format_version: 1,
        phase: Phase::Prepared,
        targets: targets.clone(),
        old: old.clone(),
        new: new.clone(),
        old_hashes: hashes(old),
        new_hashes: hashes(new),
    };
    let mut committed = false;
    let mut interrupted = false;
    let result = (|| {
        point(&mut hook, Stage::PrepareDirectorySync, &mut interrupted)?;
        sync_dir(&dir)
            .and_then(|_| sync_dir(dir.parent().expect("internal parent")))
            .and_then(|_| sync_dir(project))
            .map_err(|e| write_error(".internal/transactions", e))?;
        replace(
            &path,
            &serialize(&journal)?,
            [
                Stage::PrepareWrite,
                Stage::PrepareFileSync,
                Stage::PrepareRename,
                Stage::PrepareDirectoryCommit,
            ],
            &mut hook,
            &mut interrupted,
        )?;
        replace(
            &project.join(&targets.metadata),
            &new.metadata,
            [
                Stage::MetadataWrite,
                Stage::MetadataFileSync,
                Stage::MetadataRename,
                Stage::MetadataDirectorySync,
            ],
            &mut hook,
            &mut interrupted,
        )?;
        replace(
            &project.join(&targets.markdown),
            &new.markdown,
            [
                Stage::MarkdownWrite,
                Stage::MarkdownFileSync,
                Stage::MarkdownRename,
                Stage::MarkdownDirectorySync,
            ],
            &mut hook,
            &mut interrupted,
        )?;
        journal.phase = Phase::Committed;
        replace(
            &path,
            &serialize(&journal)?,
            [
                Stage::CommitWrite,
                Stage::CommitFileSync,
                Stage::CommitRename,
                Stage::CommitDirectorySync,
            ],
            &mut hook,
            &mut interrupted,
        )?;
        committed = true;
        point(&mut hook, Stage::Cleanup, &mut interrupted)?;
        fs::remove_file(&path).map_err(|e| write_error(".internal/transactions", e))?;
        point(&mut hook, Stage::CleanupDirectorySync, &mut interrupted)?;
        sync_dir(&dir).map_err(|e| write_error(".internal/transactions", e))
    })();
    if let Err(error) = result {
        if interrupted {
            return Err(error);
        }
        if committed {
            return Ok(());
        }
        if path.exists() {
            // A failed committed-marker replacement may already have renamed
            // the marker. Restore a durable prepared phase before rollback.
            journal.phase = Phase::Prepared;
            write_atomic(&path, &serialize(&journal)?, ".internal/transactions")?;
            recover_locked(project)?;
        }
        return Err(error);
    }
    Ok(())
}
