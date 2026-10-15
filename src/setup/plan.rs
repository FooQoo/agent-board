//! Change planning: for each target, the bytes on disk and the bytes setup
//! would write. Dry-run and a real run both stop here, so they validate alike.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::{Agent, claude, codex, env::display};
use crate::error::{AgboardError, FileAction};

/// One agent settings file, planned but not yet written.
#[derive(Debug, Clone)]
pub struct Target {
    pub agent: Agent,
    /// The path the user configured (may be a symbolic link).
    pub config_path: PathBuf,
    /// The file that is read and written: the link target for a symbolic link.
    pub file: PathBuf,
    /// Bytes on disk when planning ran; `None` when the file did not exist.
    pub original: Option<Vec<u8>>,
    /// Bytes to write; `None` when the file already has the data root.
    pub planned: Option<Vec<u8>>,
    /// Human-readable list of the additions.
    pub changes: Vec<String>,
}

/// What an adapter plans for one file. `text` is `None` when nothing changes.
#[derive(Debug)]
pub(super) struct Planned {
    pub text: Option<String>,
    pub changes: Vec<String>,
}

pub(super) fn plan(
    agent: Agent,
    config_path: &Path,
    data_root: &str,
) -> Result<Target, AgboardError> {
    let (file, original) = resolve_and_read(config_path)?;
    let text = match &original {
        Some(bytes) => Some(std::str::from_utf8(bytes).map_err(|_| {
            invalid_file(config_path, "", "The file is not UTF-8 text. Setup does not repair files; fix it and run setup again.")
        })?),
        None => None,
    };
    let planned = match agent {
        Agent::Codex => codex::plan(config_path, text, data_root)?,
        Agent::Claude => claude::plan(config_path, text, data_root)?,
    };
    Ok(Target {
        agent,
        config_path: config_path.to_path_buf(),
        file,
        planned: planned.text.map(String::into_bytes),
        original,
        changes: planned.changes,
    })
}

/// The real file behind `config_path` and its bytes. A symbolic link is followed
/// only when its target can be determined; the link itself is never replaced.
fn resolve_and_read(config_path: &Path) -> Result<(PathBuf, Option<Vec<u8>>), AgboardError> {
    let file = match fs::symlink_metadata(config_path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            fs::canonicalize(config_path).map_err(|error| AgboardError::FileError {
                action: FileAction::Read,
                file: display(config_path),
                reason: format!(
                    "The symbolic link's target cannot be determined ({error}). Setup does not replace the link; point it at a regular file and run setup again."
                ),
            })?
        }
        Ok(_) => config_path.to_path_buf(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok((config_path.to_path_buf(), None));
        }
        Err(error) => return Err(read_error(config_path, &error)),
    };
    match fs::read(&file) {
        Ok(bytes) => Ok((file, Some(bytes))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok((file, None)),
        Err(error) => Err(read_error(config_path, &error)),
    }
}

fn read_error(path: &Path, error: &io::Error) -> AgboardError {
    AgboardError::FileError {
        action: FileAction::Read,
        file: display(path),
        reason: error.to_string(),
    }
}

/// A settings file that exists but cannot be used as it is. Nothing is written.
pub(super) fn invalid_file(path: &Path, field: &str, reason: &str) -> AgboardError {
    AgboardError::FileInvalid {
        file: display(path),
        field: field.to_string(),
        reason: reason.to_string(),
    }
}

/// A file that setup cannot change in this configuration. Nothing is written;
/// `reason` carries the cause and the manual step.
pub(super) fn blocked(path: &Path, reason: String) -> AgboardError {
    AgboardError::FileError {
        action: FileAction::Write,
        file: display(path),
        reason,
    }
}
