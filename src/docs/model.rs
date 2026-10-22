//! The Docs types the routes, the reader and the writer share.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::layout;
use crate::paths;

/// Docs failures are ordinary [`AgboardError`]s with `docs_*` codes, so they
/// reach HTTP through the same mapping as every other error.
pub type DocsError = AgboardError;

/// One project's Docs folder, `<data area>/shared/projects/<project-id>/docs/`. Making a
/// `DocsRoot` creates nothing; a read of a missing folder is an empty tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocsRoot {
    dir: PathBuf,
}

impl DocsRoot {
    pub fn for_project(project: &ProjectId) -> Result<DocsRoot, DocsError> {
        let shared = paths::data_dir()?.join("shared");
        Ok(DocsRoot::of_project(&shared, project))
    }

    /// The Docs folder of a project under the shared folder.
    pub fn of_project(shared: &Path, project: &ProjectId) -> DocsRoot {
        DocsRoot {
            dir: layout::docs_dir(&layout::project_dir(shared, project)),
        }
    }

    /// A root at `dir`, for tests.
    pub fn at(dir: impl Into<PathBuf>) -> DocsRoot {
        DocsRoot { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Dir,
    File,
}

/// A folder or `.md` file in the tree. Names only, never the content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocsTreeNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DocsTreeNode>>,
}

/// `GET docs/tree`: the nodes, and whether a limit cut the listing short.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocsTree {
    pub nodes: Vec<DocsTreeNode>,
    pub truncated: bool,
}

/// `GET docs/file`: the file's exact text and the revision a save must name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsFile {
    pub path: String,
    pub content: String,
    pub revision: String,
    pub read_only: bool,
}
