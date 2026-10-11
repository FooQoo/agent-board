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

use crate::error::{AgboardError, FileAction};

/// `bytes` random bytes as lowercase hexadecimal.
pub fn random_hex(bytes: usize) -> io::Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn write_error(label: &str, reason: impl Display) -> AgboardError {
    AgboardError::FileError {
        action: FileAction::Write,
        file: label.to_string(),
        reason: reason.to_string(),
    }
}

pub fn read_error(label: &str, reason: impl Display) -> AgboardError {
    AgboardError::FileUnreadable {
        file: label.to_string(),
        reason: reason.to_string(),
    }
}

/// Replace `path` with `bytes` in one step. `label` names the file in errors.
pub fn write_atomic(path: &Path, bytes: &[u8], label: &str) -> Result<(), AgboardError> {
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
pub fn write_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), AgboardError> {
    let mut text = serde_json::to_string_pretty(value).map_err(|e| write_error(label, e))?;
    text.push('\n');
    write_atomic(path, text.as_bytes(), label)
}

pub fn read_bytes(path: &Path, label: &str) -> Result<Vec<u8>, AgboardError> {
    fs::read(path).map_err(|e| read_error(label, e))
}

pub fn read_text(path: &Path, label: &str) -> Result<String, AgboardError> {
    let bytes = read_bytes(path, label)?;
    String::from_utf8(bytes).map_err(|_| read_error(label, "the file is not valid UTF-8"))
}

/// Flush a folder's entries to disk, so a completed rename survives a crash.
pub fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

/// Remove the temporary files and folders that a crashed save left below
/// `shared`: names like `.<name>.tmp-<hex>` and `.new-<hex>` that are older
/// than `older_than`. Canonical files are never touched, and symbolic links
/// are not followed. Returns how many entries were removed.
pub fn remove_stale_temporaries(shared: &Path, older_than: std::time::Duration) -> usize {
    let mut removed = 0;
    let mut pending = vec![shared.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let temporary =
                name.starts_with('.') && (name.contains(".tmp-") || name.starts_with(".new-"));
            if temporary {
                let age = meta
                    .created()
                    .or_else(|_| meta.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok());
                if age.is_some_and(|age| age >= older_than) {
                    let result = if meta.is_dir() {
                        fs::remove_dir_all(&path)
                    } else {
                        fs::remove_file(&path)
                    };
                    if result.is_ok() {
                        removed += 1;
                    }
                }
            } else if meta.is_dir() {
                pending.push(path);
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_temporaries_are_removed_and_canonical_files_are_kept() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("projects/p1");
        fs::create_dir_all(project.join("tasks/.new-0123")).unwrap();
        fs::write(project.join("tasks/1.txt"), "x").unwrap();
        fs::write(project.join("project.json"), "{}").unwrap();
        fs::write(project.join(".project.json.tmp-0123"), "half").unwrap();
        // Nothing is older than an hour yet.
        let hour = std::time::Duration::from_secs(3600);
        assert_eq!(remove_stale_temporaries(root.path(), hour), 0);
        assert!(project.join(".project.json.tmp-0123").exists());
        // With no age limit, every temporary goes and the canonical files stay.
        assert_eq!(
            remove_stale_temporaries(root.path(), std::time::Duration::ZERO),
            2
        );
        assert!(!project.join(".project.json.tmp-0123").exists());
        assert!(!project.join("tasks/.new-0123").exists());
        assert!(project.join("project.json").exists());
        assert!(project.join("tasks/1.txt").exists());
    }

    #[test]
    fn random_hex_has_the_requested_number_of_digits() {
        let a = random_hex(16).unwrap();
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
        assert_ne!(a, random_hex(16).unwrap());
    }
}
