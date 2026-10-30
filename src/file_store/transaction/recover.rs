//! Resolving the journals left by an interrupted save.

use std::fs;
use std::path::Path;

use super::Recovery;
use super::journal::{Journal, Phase, hashes};
use super::paths::{journal_dir, read_pair, validate_targets};
use super::stage::{Fault, Stage, point, replace};
use crate::error::AgboardError;
use crate::file_store::io::{sync_dir, write_error};

/// Resolve all journals before publishing state. Hash conflicts leave every
/// conflicting pair untouched and return file_error. Recovery is repeatable.
pub fn recover_locked(project: &Path) -> Result<Recovery, AgboardError> {
    recover_with_hook_locked(project, |_| Ok(()))
}

#[doc(hidden)]
pub fn recover_with_hook_locked(
    project: &Path,
    mut hook: impl FnMut(Stage) -> Result<(), Fault>,
) -> Result<Recovery, AgboardError> {
    let dir = journal_dir(project)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Recovery::default());
        }
        Err(error) => return Err(write_error(".internal/transactions", error)),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| write_error(".internal/transactions", e))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && name.contains(".tmp-") {
            continue;
        }
        if !name.ends_with(".json")
            || !crate::file_store::validate::is_hex32(name.trim_end_matches(".json"))
            || !entry
                .file_type()
                .map_err(|e| write_error(".internal/transactions", e))?
                .is_file()
        {
            return Err(write_error(
                ".internal/transactions",
                "Unexpected transaction journal entry.",
            ));
        }
        paths.push(entry.path());
    }
    paths.sort();
    let mut recovery = Recovery::default();
    let mut interrupted = false;
    for path in paths {
        let bytes = fs::read(&path).map_err(|e| write_error(".internal/transactions", e))?;
        let journal: Journal =
            serde_json::from_slice(&bytes).map_err(|e| write_error(".internal/transactions", e))?;
        if journal.format_version != 1
            || hashes(&journal.old) != journal.old_hashes
            || hashes(&journal.new) != journal.new_hashes
        {
            return Err(write_error(
                ".internal/transactions",
                "The journal version or content hashes are invalid.",
            ));
        }
        validate_targets(project, &journal.targets)?;
        let observed = read_pair(project, &journal.targets)?;
        let observed_hashes = hashes(&observed);
        let matches = |actual: &str, old: &str, new: &str| {
            actual == new || (journal.phase == Phase::Prepared && actual == old)
        };
        if !matches(
            &observed_hashes.metadata,
            &journal.old_hashes.metadata,
            &journal.new_hashes.metadata,
        ) || !matches(
            &observed_hashes.markdown,
            &journal.old_hashes.markdown,
            &journal.new_hashes.markdown,
        ) {
            return Err(write_error(
                ".internal/transactions",
                "Transaction targets have unexpected hashes; direct edits are not overwritten.",
            ));
        }
        if journal.phase == Phase::Prepared {
            if observed.metadata != journal.old.metadata {
                replace(
                    &project.join(&journal.targets.metadata),
                    &journal.old.metadata,
                    [
                        Stage::RecoveryMetadataWrite,
                        Stage::RecoveryMetadataSync,
                        Stage::RecoveryMetadataRename,
                        Stage::RecoveryMetadataDirectorySync,
                    ],
                    &mut hook,
                    &mut interrupted,
                )?;
            }
            if observed.markdown != journal.old.markdown {
                replace(
                    &project.join(&journal.targets.markdown),
                    &journal.old.markdown,
                    [
                        Stage::RecoveryMarkdownWrite,
                        Stage::RecoveryMarkdownSync,
                        Stage::RecoveryMarkdownRename,
                        Stage::RecoveryMarkdownDirectorySync,
                    ],
                    &mut hook,
                    &mut interrupted,
                )?;
            }
        }
        point(&mut hook, Stage::Cleanup, &mut interrupted)?;
        fs::remove_file(&path).map_err(|e| write_error(".internal/transactions", e))?;
        point(&mut hook, Stage::CleanupDirectorySync, &mut interrupted)?;
        sync_dir(&dir).map_err(|e| write_error(".internal/transactions", e))?;
        recovery.recovered += 1;
        recovery.targets.push(journal.targets);
    }
    Ok(recovery)
}
