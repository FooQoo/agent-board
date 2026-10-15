//! Writing the planned files: back up each existing file, replace it through a
//! temporary file and a rename, and undo what this run wrote when a later
//! write fails. A file that changed after planning is never overwritten.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::env::display;
use super::plan::Target;
use crate::error::{AgboardError, FileAction};

/// Permission bits for a file setup creates (owner read and write only).
const NEW_FILE_MODE: u32 = 0o600;

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

/// The file's bytes, or `None` when it does not exist.
fn read_current(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Copies `bytes` to a new unique file next to `path`, with the same mode.
fn create_backup(path: &Path, bytes: &[u8], mode: u32) -> io::Result<PathBuf> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (backup, mut file) = create_unique(dir, &format!("{name}.agboard-backup"), mode)?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&backup);
        return Err(error);
    }
    set_mode(&backup, mode)?;
    Ok(backup)
}

/// Writes `bytes` to a temporary file next to `path` and renames it over
/// `path`. `path` is the real file, so a symbolic link is never replaced.
fn write_atomically(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (temporary, mut file) = create_unique(dir, &format!(".{name}.agboard-tmp"), mode)?;
    let result = file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .and_then(|()| {
            drop(file);
            set_mode(&temporary, mode)?;
            fs::rename(&temporary, path)
        });
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Creates a new file whose name starts with `base` and is unique in `dir`.
fn create_unique(dir: &Path, base: &str, mode: u32) -> io::Result<(PathBuf, File)> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    for attempt in 0..100u32 {
        let path = dir.join(format!("{base}-{stamp}-{}-{attempt}", std::process::id()));
        match open_new(&path, mode) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no free file name next to the settings file",
    ))
}

#[cfg(unix)]
fn open_new(path: &Path, mode: u32) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
}

#[cfg(not(unix))]
fn open_new(path: &Path, _mode: u32) -> io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

#[cfg(unix)]
fn file_mode(path: &Path) -> Option<u32> {
    fs::metadata(path)
        .ok()
        .map(|meta| meta.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn file_mode(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::Agent;

    fn target(file: &Path, original: Option<&[u8]>, planned: &[u8]) -> Target {
        Target {
            agent: Agent::Claude,
            config_path: file.to_path_buf(),
            file: file.to_path_buf(),
            original: original.map(<[u8]>::to_vec),
            planned: Some(planned.to_vec()),
            changes: Vec::new(),
        }
    }

    #[test]
    fn a_file_changed_after_planning_is_never_overwritten() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("settings.json");
        fs::write(&file, b"changed by someone else").unwrap();
        let stale = target(&file, Some(b"what planning saw"), b"new");
        let error = apply(&[stale]).unwrap_err();
        assert_eq!(error.code(), "file_error");
        assert!(
            error.reason().contains("nothing was overwritten"),
            "{}",
            error.reason()
        );
        assert_eq!(fs::read(&file).unwrap(), b"changed by someone else");
        assert!(backups(tmp.path()).is_empty());
    }

    #[test]
    fn a_failure_later_in_the_run_restores_the_earlier_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("config.toml");
        let second = tmp.path().join("settings.json");
        fs::write(&first, b"first original").unwrap();
        fs::write(&second, b"second changed by someone else").unwrap();
        let targets = [
            target(&first, Some(b"first original"), b"first new"),
            target(&second, Some(b"second original"), b"second new"),
        ];
        let error = apply(&targets).unwrap_err();
        assert!(error.reason().contains("restored"), "{}", error.reason());
        assert_eq!(fs::read(&first).unwrap(), b"first original");
        assert_eq!(
            fs::read(&second).unwrap(),
            b"second changed by someone else"
        );
        assert!(
            backups(tmp.path()).is_empty(),
            "backups of restored files are removed"
        );
    }

    #[test]
    fn a_new_file_is_removed_again_when_the_run_is_undone() {
        let tmp = tempfile::tempdir().unwrap();
        let created = tmp.path().join("created.json");
        let conflicting = tmp.path().join("conflict.json");
        fs::write(&conflicting, b"now present").unwrap();
        let targets = [
            target(&created, None, b"{}"),
            target(&conflicting, None, b"{}"),
        ];
        assert!(apply(&targets).is_err());
        assert!(!created.exists(), "the file this run created is removed");
        assert_eq!(fs::read(&conflicting).unwrap(), b"now present");
    }

    #[test]
    fn a_successful_apply_backs_up_and_reports_the_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("settings.json");
        fs::write(&file, b"old").unwrap();
        let backups_seen = apply(&[target(&file, Some(b"old"), b"new")]).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        let backup = backups_seen[0].clone().expect("backup path");
        assert_eq!(fs::read(backup).unwrap(), b"old");
    }

    fn backups(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.to_string_lossy().contains("agboard-"))
            .collect()
    }
}
