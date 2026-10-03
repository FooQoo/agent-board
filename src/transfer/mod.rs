//! Board export and import: file format, validation, deterministic output.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::domain::{BoardMeta, BoardSnapshot, Card};
use crate::error::SkanError;

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
    let _ = snapshot;
    todo!()
}

/// Render the file: 2-space indent, UTF-8, exactly one trailing newline.
pub fn serialize(file: &ExportFile) -> String {
    let _ = file;
    todo!()
}

/// Resolve the output path for `skan export`: no argument means
/// `<cwd>/skan.json`, a directory means `<dir>/skan.json`, anything else is
/// the file itself. Relative arguments are resolved against `cwd`.
pub fn resolve_output(arg: Option<&Path>, cwd: &Path) -> PathBuf {
    let _ = (arg, cwd);
    todo!()
}

/// Write `contents` to `path` through a temporary file in the same directory,
/// so a failure leaves any existing file untouched.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), SkanError> {
    let _ = (path, contents);
    todo!()
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
