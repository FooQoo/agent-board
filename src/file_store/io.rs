//! Reading and atomically replacing shared files.
//!
//! A save writes a temporary file in the same folder, syncs it, renames it over
//! the target, and syncs the folder. A failure before the rename leaves the
//! target as it was, and the temporary file is removed.

use std::fmt::Display;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use serde::Serialize;

use crate::error::{FileAction, SkanError};

/// `bytes` random bytes as lowercase hexadecimal.
pub fn random_hex(bytes: usize) -> io::Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn write_error(label: &str, reason: impl Display) -> SkanError {
    SkanError::FileError {
        action: FileAction::Write,
        file: label.to_string(),
        reason: reason.to_string(),
    }
}

pub fn read_error(label: &str, reason: impl Display) -> SkanError {
    SkanError::FileUnreadable {
        file: label.to_string(),
        reason: reason.to_string(),
    }
}

/// Replace `path` with `bytes` in one step. `label` names the file in errors.
pub fn write_atomic(path: &Path, bytes: &[u8], label: &str) -> Result<(), SkanError> {
    let dir = path
        .parent()
        .ok_or_else(|| write_error(label, "the path has no parent folder"))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| write_error(label, "the file name is not valid text"))?;
    let temp = dir.join(format!(
        ".{name}.tmp-{}",
        random_hex(8).map_err(|e| write_error(label, e))?
    ));
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)?;
        sync_dir(dir)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(write_error(label, error));
    }
    Ok(())
}

/// Serialize `value` as pretty JSON (two spaces, one trailing newline) and save it.
pub fn write_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), SkanError> {
    let mut text = serde_json::to_string_pretty(value).map_err(|e| write_error(label, e))?;
    text.push('\n');
    write_atomic(path, text.as_bytes(), label)
}

pub fn read_bytes(path: &Path, label: &str) -> Result<Vec<u8>, SkanError> {
    fs::read(path).map_err(|e| read_error(label, e))
}

pub fn read_text(path: &Path, label: &str) -> Result<String, SkanError> {
    let bytes = read_bytes(path, label)?;
    String::from_utf8(bytes).map_err(|_| read_error(label, "the file is not valid UTF-8"))
}

/// Flush a folder's entries to disk, so a completed rename survives a crash.
pub fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_hex_has_the_requested_number_of_digits() {
        let a = random_hex(16).unwrap();
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert_ne!(a, random_hex(16).unwrap());
    }
}
