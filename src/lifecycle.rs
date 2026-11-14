//! Exclusive lifecycle coordination for `serve`.
//!
//! The guard holds the data directory's `lifecycle.lock` file lock for as long
//! as it lives. The lock file is left in place when the guard is dropped.
use std::path::Path;
use std::time::{Duration, Instant};

use crate::error::AgboardError;
use crate::file_store::lock::LifecycleLock;

pub struct LifecycleGuard {
    _lock: LifecycleLock,
}

impl LifecycleGuard {
    /// Take the lifecycle lock of `data_dir`. A second holder gets `DatabaseBusy`.
    pub fn acquire(data_dir: &Path) -> Result<Self, AgboardError> {
        Ok(Self {
            _lock: LifecycleLock::acquire(data_dir)?,
        })
    }

    /// Take the lifecycle lock, waiting up to `wait` for a server that is still
    /// shutting down. `give_up` is asked between tries; an error it returns
    /// (another server has started meanwhile) ends the wait.
    pub fn acquire_waiting(
        data_dir: &Path,
        wait: Duration,
        give_up: impl Fn() -> Option<AgboardError>,
    ) -> Result<Self, AgboardError> {
        let deadline = Instant::now() + wait;
        loop {
            match Self::acquire(data_dir) {
                Err(AgboardError::DatabaseBusy) if Instant::now() < deadline => {
                    if let Some(error) = give_up() {
                        return Err(error);
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                other => return other,
            }
        }
    }
}
