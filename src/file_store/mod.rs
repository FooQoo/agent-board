//! Shared-file storage: every project's canonical state as files below the
//! shared directory (see MODEL.md, "共有領域の形式").
//!
//! Text (TASK.md, README.md) and operational state (task.json, project.json)
//! are kept apart. JSON writes take the project's write lock, read the latest
//! file, change only the required items, and replace the file atomically.

pub mod bindings;
pub mod detail;
mod detail_refs;
mod detail_version;
pub mod frontmatter;
pub mod history;
pub mod history_language;
pub mod image_size;
pub mod index;
pub mod io;
pub mod layout;
pub mod lock;
mod migrate;
pub mod model;
pub mod onboarding_model;
pub mod onboarding_state;
mod ops;
pub mod project;
pub mod reader;
pub mod transaction;
pub mod validate;
pub mod watch;

use std::path::{Path, PathBuf};

use crate::domain::{ProjectId, ProjectMeta};
use crate::error::AgboardError;
use model::TaskView;
pub use ops::Answer;
use reader::ProjectSnapshot;

/// Optional TASK.md fields applied together to the latest stored Markdown.
#[derive(Debug, Clone, Copy, Default)]
pub struct TaskTextParts<'a> {
    pub body: Option<&'a str>,
    pub acceptance: Option<&'a [frontmatter::AcceptanceItem]>,
}

/// The file-based store of one shared directory. Opening it reads nothing and
/// creates nothing; the first project creation writes `workspace.json`.
#[derive(Debug, Clone)]
pub struct FileStore {
    shared: PathBuf,
    history_language: Option<history_language::HistoryLanguage>,
}

impl FileStore {
    pub fn open(shared_dir: &Path) -> FileStore {
        FileStore {
            shared: shared_dir.to_path_buf(),
            history_language: None,
        }
    }

    /// Apply a browser's explicit language to this request's generated history only.
    pub fn with_history_language(
        mut self,
        language: Option<history_language::HistoryLanguage>,
    ) -> Self {
        self.history_language = language;
        self
    }

    pub(crate) fn history_language(
        &self,
        project: &ProjectId,
        task: &model::TaskFile,
    ) -> Result<history_language::HistoryLanguage, AgboardError> {
        if let Some(language) = self.history_language {
            return Ok(language);
        }
        let body = reader::read_body(self.shared_dir(), project, task.id)?;
        Ok(history_language::HistoryLanguage::infer(&body, &task.title))
    }

    pub fn shared_dir(&self) -> &Path {
        &self.shared
    }

    /// Every project, sorted by name.
    pub fn projects(&self) -> Result<Vec<ProjectMeta>, AgboardError> {
        reader::list_projects(&self.shared)
    }

    /// One project with its tasks and the defects tolerated while reading.
    pub fn snapshot(&self, id: &ProjectId) -> Result<ProjectSnapshot, AgboardError> {
        reader::read_snapshot(&self.shared, id)
    }

    /// One task, read strictly.
    pub fn task(&self, id: &ProjectId, task_id: i64) -> Result<TaskView, AgboardError> {
        reader::read_task(&self.shared, id, task_id)
    }
}
