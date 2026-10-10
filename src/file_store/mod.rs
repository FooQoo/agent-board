//! Shared-file storage: every project's canonical state as files below the
//! shared directory (see MODEL.md, "共有領域の形式").
//!
//! Text (TASK.md, README.md) and operational state (task.json, project.json)
//! are kept apart. JSON writes take the project's write lock, read the latest
//! file, change only the required items, and replace the file atomically.

pub mod io;
pub mod layout;
pub mod lock;
pub mod model;
mod ops;
pub mod project;
pub mod reader;
pub mod validate;

use std::path::{Path, PathBuf};

use crate::domain::{ProjectId, ProjectMeta};
use crate::error::SkanError;
use model::CardView;
use reader::ProjectSnapshot;

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

    /// Every project, sorted by name.
    pub fn projects(&self) -> Result<Vec<ProjectMeta>, SkanError> {
        reader::list_projects(&self.shared)
    }

    /// One project with its cards and the defects tolerated while reading.
    pub fn snapshot(&self, id: &ProjectId) -> Result<ProjectSnapshot, SkanError> {
        reader::read_snapshot(&self.shared, id)
    }

    /// One card, read strictly.
    pub fn card(&self, id: &ProjectId, card_id: i64) -> Result<CardView, SkanError> {
        reader::read_card(&self.shared, id, card_id)
    }
}
