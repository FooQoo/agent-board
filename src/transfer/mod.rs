//! Board export and import: file format, validation, deterministic output.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::domain::{BoardMeta, BoardSnapshot, Card};
use crate::error::{FileAction, SkanError};

/// The value of `format` in every export file.
pub const FORMAT: &str = "skan-board";
/// The only supported `version`.
pub const VERSION: u32 = 1;

/// The file name used when an export path is omitted or is a directory.
const DEFAULT_FILE_NAME: &str = "skan.json";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The export file (`skan.json`). Field order is the key order in the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportFile {
    pub format: String,
    pub version: u32,
    pub board: BoardMeta,
    pub cards: Vec<Card>,
}

/// Build the export file from a snapshot. Cards are in ascending ID order.
pub fn to_export_file(snapshot: &BoardSnapshot) -> ExportFile {
    let mut cards = snapshot.cards.clone();
    cards.sort_by_key(|card| card.id);
    ExportFile {
        format: FORMAT.to_string(),
        version: VERSION,
        board: snapshot.board.clone(),
        cards,
    }
}

/// Render the file: 2-space indent, UTF-8, exactly one trailing newline.
pub fn serialize(file: &ExportFile) -> String {
    let mut text =
        serde_json::to_string_pretty(file).expect("an export file is always serializable");
    text.push('\n');
    text
}

/// Resolve the output path for `skan export`: no argument means
/// `<cwd>/skan.json`, a directory means `<dir>/skan.json`, anything else is
/// the file itself. Relative arguments are resolved against `cwd`.
pub fn resolve_output(arg: Option<&Path>, cwd: &Path) -> PathBuf {
    let joined = match arg {
        None => cwd.join(DEFAULT_FILE_NAME),
        Some(arg) => {
            let path = cwd.join(arg);
            if path.is_dir() {
                path.join(DEFAULT_FILE_NAME)
            } else {
                path
            }
        }
    };
    // Drop "." components so `./skan.json` and `skan.json` resolve alike.
    joined.components().collect()
}

/// Write `contents` to `path` through a temporary file in the same directory,
/// so a failure leaves any existing file untouched.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), SkanError> {
    let file_error = |reason: String| SkanError::FileError {
        action: FileAction::Write,
        file: path.display().to_string(),
        reason,
    };
    let name = path
        .file_name()
        .ok_or_else(|| file_error("The path has no file name.".to_string()))?;
    let dir = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };

    // A temporary file next to the target keeps the final rename on one file
    // system. `rename` replaces an existing file on Unix and on Windows.
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut temp_name = OsString::from(".");
    temp_name.push(name);
    temp_name.push(format!(".{}.{counter}.tmp", std::process::id()));
    let temp_path = dir.join(temp_name);

    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(error.to_string()));
    }
    Ok(())
}

/// Read `path` and validate it. Unreadable files are `FileError`; files that
/// are not valid board files are `ImportInvalid`.
pub fn read_and_validate(path: &Path) -> Result<BoardSnapshot, SkanError> {
    let _ = path;
    todo!()
}

/// Check every import rule and return the first violation as `ImportInvalid`.
pub fn validate(file: &ExportFile) -> Result<BoardSnapshot, SkanError> {
    let _ = file;
    todo!()
}
