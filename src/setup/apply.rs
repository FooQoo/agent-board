//! Writing the planned files: back up each existing file, replace it through a
//! temporary file and a rename, and undo what this run wrote when a later
//! write fails. A file that changed after planning is never overwritten.

mod files;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::PathBuf;

use self::files::create_backup;
pub(crate) use self::files::{NEW_FILE_MODE, file_mode, read_current, write_atomically};
use super::env::display;
use super::plan::Target;
use crate::error::{AgboardError, FileAction};

/// One failed step, before rollback turns it into the reported error.
struct Failure {
    file: String,
    detail: String,
}

/// A write this run has started. `written` is set once the new bytes are in
/// place; before that only the backup may exist.
struct Done {
    index: usize,
    backup: Option<PathBuf>,
    written: bool,
}

/// Writes every planned change. Returns the backup path for each target, in
/// the order of `targets` (`None` where no backup was needed).
pub(super) fn apply(targets: &[Target]) -> Result<Vec<Option<PathBuf>>, AgboardError> {
    let mut done: Vec<Done> = Vec::new();
    for (index, target) in targets.iter().enumerate() {
        if target.planned.is_none() {
            continue;
        }
        if let Err(failure) = write_target(index, target, &mut done) {
            return Err(roll_back(targets, done, failure));
        }
    }
    let mut backups = vec![None; targets.len()];
    for entry in done {
        backups[entry.index] = entry.backup;
    }
    Ok(backups)
}

fn write_target(index: usize, target: &Target, done: &mut Vec<Done>) -> Result<(), Failure> {
    let failure = |detail: String| Failure {
        file: display(&target.config_path),
        detail,
    };
    let planned = target.planned.as_deref().unwrap_or_default();
    let current = read_current(&target.file).map_err(|error| failure(error.to_string()))?;
    if current != target.original {
        return Err(failure(
            "changed while setup was running; nothing was overwritten. Run setup again.".into(),
        ));
    }
    let mode = file_mode(&target.file).unwrap_or(NEW_FILE_MODE);
    let backup = match &target.original {
        Some(bytes) => Some(
            create_backup(&target.file, bytes, mode).map_err(|error| failure(error.to_string()))?,
        ),
        None => None,
    };
    done.push(Done {
        index,
        backup,
        written: false,
    });
    let position = done.len() - 1;
    if let Some(parent) = target.file.parent() {
        fs::create_dir_all(parent).map_err(|error| failure(error.to_string()))?;
    }
    write_atomically(&target.file, planned, mode).map_err(|error| failure(error.to_string()))?;
    done[position].written = true;
    Ok(())
}

/// Undoes the writes of this run, newest first. Returns the error to report.
fn roll_back(targets: &[Target], done: Vec<Done>, failure: Failure) -> AgboardError {
    let mut stuck: Vec<String> = Vec::new();
    for entry in done.iter().rev() {
        let target = &targets[entry.index];
        let restored = if entry.written {
            restore(target)
        } else {
            Ok(())
        };
        match restored {
            Ok(()) => {
                if let Some(backup) = &entry.backup {
                    let _ = fs::remove_file(backup);
                }
            }
            Err(detail) => stuck.push(format!(
                "{} ({detail}); backup kept at {}",
                display(&target.config_path),
                entry
                    .backup
                    .as_deref()
                    .map(display)
                    .unwrap_or_else(|| "none".into())
            )),
        }
    }
    let reason = if stuck.is_empty() {
        format!(
            "{}. Files already written by this run were restored.",
            failure.detail
        )
    } else {
        format!(
            "{}. These files could not be restored: {}. Restore them from the backup by hand.",
            failure.detail,
            stuck.join("; ")
        )
    };
    AgboardError::FileError {
        action: FileAction::Write,
        file: failure.file,
        reason,
    }
}

/// Puts the original bytes back, unless the file changed since this run wrote it.
fn restore(target: &Target) -> Result<(), String> {
    let current = read_current(&target.file).map_err(|error| error.to_string())?;
    if current != target.planned {
        return Err("changed by another program since setup wrote it; left as it is".into());
    }
    match &target.original {
        Some(bytes) => {
            let mode = file_mode(&target.file).unwrap_or(NEW_FILE_MODE);
            write_atomically(&target.file, bytes, mode).map_err(|error| error.to_string())
        }
        None => fs::remove_file(&target.file).map_err(|error| error.to_string()),
    }
}
