//! Standard file locks (`File::lock` / `File::try_lock`).
//!
//! A lock is held by an open file, so it is released when the handle is
//! dropped, including when the process exits. Lock files are never deleted:
//! removing one while another process waits on it would let two holders in.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::Path;

use crate::error::{FileAction, SkanError};

/// The write lock of one project or of the catalog. Acquiring it waits for
/// the current holder. Keep it only for reading the latest JSON through the
/// save; never hold it across a network call or while waiting for a user.
#[derive(Debug)]
pub struct WriteLock {
    _file: File,
}

impl WriteLock {
    pub fn acquire(path: &Path) -> Result<WriteLock, SkanError> {
        let label = path.display().to_string();
        let file = open_lock_file(path).map_err(|e| SkanError::FileError {
            action: FileAction::Write,
            file: label.clone(),
            reason: e.to_string(),
        })?;
        file.lock().map_err(|e| SkanError::FileError {
            action: FileAction::Write,
            file: label,
            reason: e.to_string(),
        })?;
        Ok(WriteLock { _file: file })
    }
}

/// The lock that keeps one `serve` (or one explicit migration) running per
/// data directory. A second holder is refused at once with `DatabaseBusy`.
#[derive(Debug)]
pub struct LifecycleLock {
    _file: File,
}

impl LifecycleLock {
    pub fn acquire(data_dir: &Path) -> Result<LifecycleLock, SkanError> {
        fs::create_dir_all(data_dir).map_err(|e| SkanError::DatabaseError {
            reason: e.to_string(),
        })?;
        let file = open_lock_file(&data_dir.join("lifecycle.lock")).map_err(|e| {
            SkanError::DatabaseError {
                reason: e.to_string(),
            }
        })?;
        match file.try_lock() {
            Ok(()) => Ok(LifecycleLock { _file: file }),
            Err(TryLockError::WouldBlock) => Err(SkanError::DatabaseBusy),
            Err(TryLockError::Error(e)) => Err(SkanError::DatabaseError {
                reason: e.to_string(),
            }),
        }
    }
}

fn open_lock_file(path: &Path) -> std::io::Result<File> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}
