//! Shared-file storage: every project's canonical state as files below the
//! shared directory (see MODEL.md, "共有領域の形式").
//!
//! Text (TASK.md, README.md) and operational state (task.json, project.json)
//! are kept apart. JSON writes take the project's write lock, read the latest
//! file, change only the required items, and replace the file atomically.

pub mod io;
pub mod layout;
pub mod lock;

use std::path::{Path, PathBuf};

/// The file-based store of one shared directory. Opening it reads nothing and
/// creates nothing; the first project creation writes `workspace.json`.
#[derive(Debug, Clone)]
pub struct FileStore {
    shared: PathBuf,
}

impl FileStore {
    pub fn open(shared_dir: &Path) -> FileStore {
        FileStore {
            shared: shared_dir.to_path_buf(),
        }
    }

    pub fn shared_dir(&self) -> &Path {
        &self.shared
    }
}
