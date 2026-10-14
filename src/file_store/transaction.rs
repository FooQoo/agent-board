//! Durable replacement of one card's JSON/Markdown pair.
//!
//! Callers must hold the project's WriteLock for save and recovery, and must
//! recover before reading public state. Prepared journals roll back; committed
//! journals retain the new pair. Unexpected bytes block recovery rather than
//! overwriting a direct edit. The module never sends notifications.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::io::{random_hex, sync_dir, write_atomic, write_error};
use crate::error::AgboardError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairTargets {
    pub metadata: PathBuf,
    pub markdown: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairBytes {
    pub metadata: Vec<u8>,
    pub markdown: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Prepared,
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Journal {
    format_version: u32,
    phase: Phase,
    targets: PairTargets,
    old: PairBytes,
    new: PairBytes,
    old_hashes: PairHashes,
    new_hashes: PairHashes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PairHashes {
    metadata: String,
    markdown: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Recovery {
    /// Journals whose prepared/committed pair was resolved.
    pub recovered: usize,
    /// Relative card targets that recovery resolved, for cache invalidation.
    pub targets: Vec<PairTargets>,
}

/// Injection points used by storage tests. Hooks are ordinary Rust arguments;
/// they have no environment-variable, file, or CLI configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    PrepareDirectorySync,
    PrepareWrite,
    PrepareFileSync,
    PrepareRename,
    PrepareDirectoryCommit,
    MetadataWrite,
    MetadataFileSync,
    MetadataRename,
    MetadataDirectorySync,
    MarkdownWrite,
    MarkdownFileSync,
    MarkdownRename,
    MarkdownDirectorySync,
    CommitWrite,
    CommitFileSync,
    CommitRename,
    CommitDirectorySync,
    Cleanup,
    CleanupDirectorySync,
    RecoveryMetadataWrite,
    RecoveryMetadataSync,
    RecoveryMetadataRename,
    RecoveryMetadataDirectorySync,
    RecoveryMarkdownWrite,
    RecoveryMarkdownSync,
    RecoveryMarkdownRename,
    RecoveryMarkdownDirectorySync,
}

impl Stage {
    pub const SAVE_STAGES: &'static [Stage] = &[
        Self::PrepareDirectorySync,
        Self::PrepareWrite,
        Self::PrepareFileSync,
        Self::PrepareRename,
        Self::PrepareDirectoryCommit,
        Self::MetadataWrite,
        Self::MetadataFileSync,
        Self::MetadataRename,
        Self::MetadataDirectorySync,
        Self::MarkdownWrite,
        Self::MarkdownFileSync,
        Self::MarkdownRename,
        Self::MarkdownDirectorySync,
        Self::CommitWrite,
        Self::CommitFileSync,
        Self::CommitRename,
        Self::CommitDirectorySync,
        Self::Cleanup,
        Self::CleanupDirectorySync,
    ];

    pub fn is_after_commit(self) -> bool {
        matches!(self, Self::Cleanup | Self::CleanupDirectorySync)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    /// A reported I/O failure: save rolls back before returning an error.
    Fail,
    /// Simulated process interruption: leave the journal for the next entry.
    Interrupt,
}

type Hook<'a> = dyn FnMut(Stage) -> Result<(), Fault> + 'a;

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hashes(bytes: &PairBytes) -> PairHashes {
    PairHashes {
        metadata: hash(&bytes.metadata),
        markdown: hash(&bytes.markdown),
    }
}

fn label(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn validate_targets(project: &Path, targets: &PairTargets) -> Result<(), AgboardError> {
    let valid = |path: &Path, filename: &str| -> Option<String> {
        let parts: Vec<_> = path.components().collect();
        let [
            Component::Normal(tasks),
            Component::Normal(id),
            Component::Normal(name),
        ] = parts.as_slice()
        else {
            return None;
        };
        let id = id.to_str()?;
        if *tasks != "tasks"
            || *name != filename
            || id.parse::<i64>().ok().filter(|n| *n > 0).is_none()
            || id.starts_with('0')
            || !id.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Some(id.into())
    };
    let json = valid(&targets.metadata, "task.json");
    if json.is_none() || json != valid(&targets.markdown, "TASK.md") {
        return Err(write_error(
            ".internal/transactions",
            "Transaction targets must be task.json and TASK.md of the same card.",
        ));
    }
    for target in [&targets.metadata, &targets.markdown] {
        reject_symlinks(project, target)?;
    }
    Ok(())
}

fn reject_symlinks(project: &Path, relative: &Path) -> Result<(), AgboardError> {
    let mut path = project.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(write_error(
                &label(relative),
                "Only relative normal path components are allowed.",
            ));
        }
        path.push(component.as_os_str());
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(write_error(
                    &label(relative),
                    "Transaction paths cannot contain symbolic links.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(write_error(&label(relative), error)),
        }
    }
    Ok(())
}

fn journal_dir(project: &Path) -> Result<PathBuf, AgboardError> {
    let relative = Path::new(".internal/transactions");
    reject_symlinks(project, relative)?;
    Ok(project.join(relative))
}

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

fn serialize(journal: &Journal) -> Result<Vec<u8>, AgboardError> {
    serde_json::to_vec(journal).map_err(|e| write_error(".internal/transactions", e))
}

fn read_pair(project: &Path, targets: &PairTargets) -> Result<PairBytes, AgboardError> {
    Ok(PairBytes {
        metadata: fs::read(project.join(&targets.metadata))
            .map_err(|e| write_error(&label(&targets.metadata), e))?,
        markdown: fs::read(project.join(&targets.markdown))
            .map_err(|e| write_error(&label(&targets.markdown), e))?,
    })
}

fn point(hook: &mut Hook<'_>, stage: Stage, interrupted: &mut bool) -> Result<(), AgboardError> {
    hook(stage).map_err(|fault| {
        *interrupted = fault == Fault::Interrupt;
        write_error(
            ".internal/transactions",
            format!("Injected {fault:?} at {stage:?}."),
        )
    })
}

fn replace(
    path: &Path,
    bytes: &[u8],
    stages: [Stage; 4],
    hook: &mut Hook<'_>,
    interrupted: &mut bool,
) -> Result<(), AgboardError> {
    let parent = path.parent().expect("validated target parent");
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .expect("validated filename")
            .to_string_lossy(),
        random_hex(8).map_err(|e| write_error(".internal/transactions", e))?
    ));
    let result = (|| {
        point(hook, stages[0], interrupted)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| write_error(".internal/transactions", e))?;
        file.write_all(bytes)
            .map_err(|e| write_error(".internal/transactions", e))?;
        point(hook, stages[1], interrupted)?;
        file.sync_all()
            .map_err(|e| write_error(".internal/transactions", e))?;
        drop(file);
        point(hook, stages[2], interrupted)?;
        fs::rename(&temp, path).map_err(|e| write_error(".internal/transactions", e))?;
        point(hook, stages[3], interrupted)?;
        sync_dir(parent).map_err(|e| write_error(".internal/transactions", e))
    })();
    if result.is_err() && !*interrupted {
        let _ = fs::remove_file(&temp);
    }
    result
}

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
            || !super::validate::is_hex32(name.trim_end_matches(".json"))
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
