//! Durable replacement of several files as one change: messages and the task pairs that
//! refer to them.
//!
//! The journal lives in `.internal/batches/` and records every target with its old and new
//! bytes (`null` for a file that does not exist before or after). A prepared journal rolls
//! back, a committed one keeps the new files. Unexpected bytes block recovery rather than
//! overwriting a direct edit. Callers hold the project's WriteLock.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::journal::{Phase, hash};
use super::paths::reject_symlinks;
use crate::error::AgboardError;
use crate::file_store::io::{random_hex, sync_dir, write_atomic, write_error};
use crate::file_store::qa::question_number;
use crate::file_store::validate::{EpicId, is_hex32};

const DIR: &str = ".internal/batches";

/// One file of a batch: its project-relative path and its bytes before and after.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FileChange {
    pub target: PathBuf,
    pub old: Option<Vec<u8>>,
    pub new: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BatchJournal {
    format_version: u32,
    phase: Phase,
    changes: Vec<FileChange>,
    hashes: Vec<(Option<String>, Option<String>)>,
}

fn label(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn hashes(changes: &[FileChange]) -> Vec<(Option<String>, Option<String>)> {
    changes
        .iter()
        .map(|c| (c.old.as_deref().map(hash), c.new.as_deref().map(hash)))
        .collect()
}

/// Only a message file and the files of a task or an epic may be part of a batch.
fn validate_target(project: &Path, target: &Path) -> Result<(), AgboardError> {
    let parts: Vec<_> = target.components().collect();
    let ok = match parts.as_slice() {
        [
            Component::Normal(a),
            Component::Normal(b),
            Component::Normal(c),
        ] => {
            let (a, b, c) = (a.to_str(), b.to_str(), c.to_str());
            match (a, b, c) {
                (Some("qa"), Some(id), Some("QA.md")) => question_number(id).is_some(),
                (Some("tasks"), Some(id), Some("task.json" | "TASK.md")) => {
                    !id.starts_with('0')
                        && id.bytes().all(|b| b.is_ascii_digit())
                        && id.parse::<i64>().is_ok_and(|n| n > 0)
                }
                (Some("epics"), Some(id), Some("epic.json")) => id.parse::<EpicId>().is_ok(),
                _ => false,
            }
        }
        _ => false,
    };
    if !ok {
        return Err(write_error(
            DIR,
            "Batch targets must be message, task or epic files.",
        ));
    }
    reject_symlinks(project, target)
}

fn read_optional(project: &Path, target: &Path) -> Result<Option<Vec<u8>>, AgboardError> {
    match fs::read(project.join(target)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(write_error(&label(target), e)),
    }
}

/// Put `bytes` at `target`, or remove it (and its folder, when the folder is left empty).
fn place(project: &Path, target: &Path, bytes: Option<&[u8]>) -> Result<(), AgboardError> {
    let path = project.join(target);
    let parent = path
        .parent()
        .expect("batch targets have a folder")
        .to_path_buf();
    match bytes {
        Some(bytes) => {
            if !parent.is_dir() {
                fs::create_dir_all(&parent).map_err(|e| write_error(&label(target), e))?;
                if let Some(grand) = parent.parent() {
                    sync_dir(grand).map_err(|e| write_error(&label(target), e))?;
                }
            }
            write_atomic(&path, bytes, &label(target))
        }
        None => {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(write_error(&label(target), e)),
            }
            if fs::read_dir(&parent).is_ok_and(|mut entries| entries.next().is_none()) {
                let _ = fs::remove_dir(&parent);
            }
            if let Some(grand) = parent.parent() {
                sync_dir(grand).map_err(|e| write_error(&label(target), e))?;
            }
            Ok(())
        }
    }
}

fn write_journal(path: &Path, journal: &BatchJournal) -> Result<(), AgboardError> {
    let bytes = serde_json::to_vec(journal).map_err(|e| write_error(DIR, e))?;
    write_atomic(path, &bytes, DIR)
}

/// Save every change, or none of them. Each `old` must still match its file.
pub fn save_batch_locked(project: &Path, changes: Vec<FileChange>) -> Result<(), AgboardError> {
    save_batch_reporting(project, changes).map_err(|failure| failure.error)
}

/// Why a batch failed, and whether it had passed its commit point (the `Committed` journal was
/// written) when it did. Recovery keeps a committed batch, so what it names must stay.
#[derive(Debug)]
pub struct BatchFailure {
    pub error: AgboardError,
    pub committed: bool,
}

impl BatchFailure {
    /// A failure before the commit point.
    pub fn before(error: AgboardError) -> Self {
        Self {
            error,
            committed: false,
        }
    }

    /// A failure after the commit point.
    pub fn after(error: AgboardError) -> Self {
        Self {
            error,
            committed: true,
        }
    }
}

/// `save_batch_locked`, telling the caller whether a failure came after the commit point.
pub fn save_batch_reporting(project: &Path, changes: Vec<FileChange>) -> Result<(), BatchFailure> {
    recover_batches_locked(project).map_err(BatchFailure::before)?;
    for change in &changes {
        validate_target(project, &change.target).map_err(BatchFailure::before)?;
        if read_optional(project, &change.target).map_err(BatchFailure::before)? != change.old {
            return Err(BatchFailure::before(write_error(
                &label(&change.target),
                "The file changed before saving.",
            )));
        }
    }
    let changes: Vec<FileChange> = changes.into_iter().filter(|c| c.old != c.new).collect();
    if changes.is_empty() {
        return Ok(());
    }
    reject_symlinks(project, Path::new(DIR)).map_err(BatchFailure::before)?;
    let dir = project.join(DIR);
    fs::create_dir_all(&dir).map_err(|e| BatchFailure::before(write_error(DIR, e)))?;
    let path = dir.join(format!(
        "{}.json",
        random_hex(16).map_err(|e| BatchFailure::before(write_error(DIR, e)))?
    ));
    let mut journal = BatchJournal {
        format_version: 1,
        phase: Phase::Prepared,
        hashes: hashes(&changes),
        changes,
    };
    write_journal(&path, &journal).map_err(BatchFailure::before)?;
    sync_dir(&dir).map_err(|e| BatchFailure::before(write_error(DIR, e)))?;
    let applied = journal
        .changes
        .iter()
        .try_for_each(|c| place(project, &c.target, c.new.as_deref()));
    if let Err(error) = applied {
        for change in journal.changes.iter().rev() {
            place(project, &change.target, change.old.as_deref()).map_err(BatchFailure::before)?;
        }
        let _ = fs::remove_file(&path);
        return Err(BatchFailure::before(error));
    }
    journal.phase = Phase::Committed;
    if let Err(error) = write_journal(&path, &journal) {
        recover_batches_locked(project).map_err(BatchFailure::before)?;
        return Err(BatchFailure::before(error));
    }
    finish_committed(&path, &dir)
}

/// Remove the journal of a committed batch. The new files are durable already, so a failure
/// here is reported as one that came after the commit point.
fn finish_committed(journal: &Path, dir: &Path) -> Result<(), BatchFailure> {
    fs::remove_file(journal).map_err(|e| BatchFailure::after(write_error(DIR, e)))?;
    sync_dir(dir).map_err(|e| BatchFailure::after(write_error(DIR, e)))
}

/// Resolve the journals of interrupted batches: roll prepared ones back, keep committed ones.
/// Returns the targets that were resolved.
pub fn recover_batches_locked(project: &Path) -> Result<Vec<PathBuf>, AgboardError> {
    let dir = project.join(DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(write_error(DIR, e)),
    };
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| write_error(DIR, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && name.contains(".tmp-") {
            continue;
        }
        if !name.ends_with(".json") || !is_hex32(name.trim_end_matches(".json")) {
            return Err(write_error(DIR, "Unexpected batch journal entry."));
        }
        paths.push(entry.path());
    }
    paths.sort();
    let mut resolved = Vec::new();
    for path in paths {
        let bytes = fs::read(&path).map_err(|e| write_error(DIR, e))?;
        let journal: BatchJournal =
            serde_json::from_slice(&bytes).map_err(|e| write_error(DIR, e))?;
        if journal.format_version != 1 || hashes(&journal.changes) != journal.hashes {
            return Err(write_error(DIR, "The batch journal is invalid."));
        }
        for change in &journal.changes {
            validate_target(project, &change.target)?;
            let observed = read_optional(project, &change.target)?;
            let allowed = observed == change.new
                || (journal.phase == Phase::Prepared && observed == change.old);
            if !allowed {
                return Err(write_error(
                    DIR,
                    "Batch targets have unexpected contents; direct edits are not overwritten.",
                ));
            }
        }
        if journal.phase == Phase::Prepared {
            for change in journal.changes.iter().rev() {
                if read_optional(project, &change.target)? != change.old {
                    place(project, &change.target, change.old.as_deref())?;
                }
            }
        }
        fs::remove_file(&path).map_err(|e| write_error(DIR, e))?;
        sync_dir(&dir).map_err(|e| write_error(DIR, e))?;
        resolved.extend(journal.changes.into_iter().map(|c| c.target));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RID: &str = "0123456789abcdef0123456789abcdef";
    const QID: &str = "Q-1";

    fn change(target: &str, old: Option<&str>, new: Option<&str>) -> FileChange {
        FileChange {
            target: PathBuf::from(target),
            old: old.map(|s| s.as_bytes().to_vec()),
            new: new.map(|s| s.as_bytes().to_vec()),
        }
    }

    #[test]
    fn saves_every_file_or_none() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path();
        fs::create_dir_all(project.join("tasks/1")).unwrap();
        fs::write(project.join("tasks/1/TASK.md"), "old").unwrap();
        save_batch_locked(
            project,
            vec![
                change(&format!("qa/{QID}/QA.md"), None, Some("{}")),
                change("tasks/1/TASK.md", Some("old"), Some("new")),
            ],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(project.join("tasks/1/TASK.md")).unwrap(),
            "new"
        );
        assert!(project.join(format!("qa/{QID}/QA.md")).is_file());

        // A stale old value writes nothing.
        let err = save_batch_locked(
            project,
            vec![change("tasks/1/TASK.md", Some("old"), Some("newer"))],
        );
        assert!(err.is_err());
        assert_eq!(
            fs::read_to_string(project.join("tasks/1/TASK.md")).unwrap(),
            "new"
        );
    }

    #[test]
    fn a_prepared_journal_rolls_back() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path();
        fs::create_dir_all(project.join("tasks/1")).unwrap();
        fs::write(project.join("tasks/1/TASK.md"), "new").unwrap();
        fs::create_dir_all(project.join(format!("qa/{QID}"))).unwrap();
        fs::write(project.join(format!("qa/{QID}/QA.md")), "{}").unwrap();
        let changes = vec![
            change(&format!("qa/{QID}/QA.md"), None, Some("{}")),
            change("tasks/1/TASK.md", Some("old"), Some("new")),
        ];
        let journal = BatchJournal {
            format_version: 1,
            phase: Phase::Prepared,
            hashes: hashes(&changes),
            changes,
        };
        fs::create_dir_all(project.join(DIR)).unwrap();
        write_journal(&project.join(DIR).join(format!("{RID}.json")), &journal).unwrap();
        recover_batches_locked(project).unwrap();
        assert_eq!(
            fs::read_to_string(project.join("tasks/1/TASK.md")).unwrap(),
            "old"
        );
        assert!(!project.join(format!("qa/{QID}")).exists());
    }

    #[test]
    fn other_targets_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let err = save_batch_locked(root.path(), vec![change("project.json", None, Some("x"))]);
        assert!(err.is_err());
    }

    #[test]
    fn a_failure_reports_whether_the_commit_point_was_reached() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path();
        fs::create_dir_all(project.join("tasks/1")).unwrap();
        fs::write(project.join("tasks/1/TASK.md"), "old").unwrap();

        // A stale old value fails before anything is journaled.
        let failure = save_batch_reporting(
            project,
            vec![change("tasks/1/TASK.md", Some("stale"), Some("new"))],
        )
        .unwrap_err();
        assert!(!failure.committed);

        // Cleanup that fails after the journal was marked committed is past the commit point.
        let failure = finish_committed(&project.join("missing.json"), project).unwrap_err();
        assert!(failure.committed);
    }
}
