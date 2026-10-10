//! Exclusive lifecycle coordination for serve and explicit migrations.
//!
//! The guard holds the data directory's `lifecycle.lock` file lock for as long
//! as it lives. The lock file is left in place when the guard is dropped.
use std::path::Path;

use crate::error::SkanError;
use crate::file_store::lock::LifecycleLock;

pub struct LifecycleGuard {
    _lock: LifecycleLock,
}

impl LifecycleGuard {
    /// Take the lifecycle lock of `data_dir`. A second holder gets `DatabaseBusy`.
    pub fn acquire(data_dir: &Path) -> Result<Self, SkanError> {
        Ok(Self {
            _lock: LifecycleLock::acquire(data_dir)?,
        })
    }
}
