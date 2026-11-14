//! Standard file locks (`File::lock` / `File::try_lock`).
//!
//! A lock is held by an open file, so it is released when the handle is
//! dropped, including when the process exits. Lock files are never deleted:
//! removing one while another process waits on it would let two holders in.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::Path;

use crate::error::{AgboardError, FileAction};

/// The write lock of one project or of the catalog. Acquiring it waits for
/// the current holder. Keep it only for reading the latest JSON through the
/// save; never hold it across a network call or while waiting for a user.
#[derive(Debug)]
pub struct WriteLock {
    _file: File,
}

impl WriteLock {
    /// Wait at most `WRITE_LOCK_WAIT` for the holder; after that the write is
    /// refused with `database_busy` and nothing is changed.
    pub fn acquire(path: &Path) -> Result<WriteLock, AgboardError> {
        let label = path.display().to_string();
        let file = open_lock_file(path).map_err(|e| AgboardError::FileError {
            action: FileAction::Write,
            file: label.clone(),
            reason: e.to_string(),
        })?;
        let began = std::time::Instant::now();
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(WriteLock { _file: file }),
                Err(TryLockError::WouldBlock) if began.elapsed() < WRITE_LOCK_WAIT => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(TryLockError::WouldBlock) => return Err(AgboardError::DatabaseBusy),
                Err(TryLockError::Error(e)) => {
                    return Err(AgboardError::FileError {
                        action: FileAction::Write,
                        file: label,
                        reason: e.to_string(),
                    });
                }
            }
        }
    }
}

/// How long a write waits for another writer of the same project (ARCHITECTURE.md, "同時実行").
pub const WRITE_LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// The lock that keeps one `serve` running per data directory. A second holder is refused at once with `DatabaseBusy`.
#[derive(Debug)]
pub struct LifecycleLock {
    _file: File,
}

impl LifecycleLock {
    pub fn acquire(data_dir: &Path) -> Result<LifecycleLock, AgboardError> {
        fs::create_dir_all(data_dir).map_err(|e| AgboardError::DatabaseError {
            reason: e.to_string(),
        })?;
        let file = open_lock_file(&data_dir.join("lifecycle.lock")).map_err(|e| {
            AgboardError::DatabaseError {
                reason: e.to_string(),
            }
        })?;
        match file.try_lock() {
            Ok(()) => Ok(LifecycleLock { _file: file }),
            Err(TryLockError::WouldBlock) => Err(AgboardError::DatabaseBusy),
            Err(TryLockError::Error(e)) => Err(AgboardError::DatabaseError {
                reason: e.to_string(),
            }),
        }
    }
}

/// The lock that puts commands starting a server for the same data directory
/// in turn (`autostart.lock`). The started server keeps it until it is ready.
#[derive(Debug)]
pub struct AutostartLock {
    file: File,
}

impl AutostartLock {
    /// Wait at most `wait` for another command that is starting the server.
    pub fn acquire_waiting(
        data_dir: &Path,
        wait: std::time::Duration,
    ) -> Result<Self, AgboardError> {
        let file = Self::open(data_dir)?;
        let began = std::time::Instant::now();
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(AutostartLock { file }),
                Err(TryLockError::WouldBlock) if began.elapsed() < wait => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(TryLockError::WouldBlock) => {
                    return Err(AgboardError::BoardUnavailable {
                        reason: format!(
                            "Another agboard command was still starting the server after {} seconds. Try again.",
                            wait.as_secs()
                        ),
                    });
                }
                Err(TryLockError::Error(e)) => return Err(unavailable(e)),
            }
        }
    }

    /// Take the lock only if nobody holds it.
    pub fn try_acquire(data_dir: &Path) -> Option<Self> {
        let file = Self::open(data_dir).ok()?;
        file.try_lock().ok()?;
        Some(AutostartLock { file })
    }

    /// The open lock file, to hand to the server being started.
    pub fn file(&self) -> &File {
        &self.file
    }

    fn open(data_dir: &Path) -> Result<File, AgboardError> {
        open_lock_file(&data_dir.join("autostart.lock")).map_err(unavailable)
    }
}

fn unavailable(error: std::io::Error) -> AgboardError {
    AgboardError::BoardUnavailable {
        reason: format!("Cannot open autostart.lock: {error}."),
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
