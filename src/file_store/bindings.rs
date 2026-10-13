//! Folder bindings: the project a local folder works on.
//!
//! The bindings are kept in the data directory beside `shared/`, never in the
//! shared files, so one machine's folder paths are not shared. A binding names
//! its project by ID: a rename keeps the binding, and a project created later
//! under the same name is never taken for the old one. A folder belongs to one
//! project; a project may have several folders.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::FileStore;
use super::io;
use super::layout::FORMAT_VERSION;
use super::lock::WriteLock;
use super::reader;
use crate::domain::{Changed, ProjectId, ProjectMeta};
use crate::error::AgboardError;

/// The file that holds the bindings, beside the `shared` folder.
pub const BINDINGS_FILE: &str = "bindings.json";
const BINDINGS_LOCK: &str = ".bindings.lock";

/// A folder bound to a project. `folder` is canonical, so it compares equal
/// to the folder a command starts from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub project_id: ProjectId,
    pub folder: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingsFile {
    format_version: u32,
    bindings: Vec<BindingEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingEntry {
    project_id: String,
    folder: PathBuf,
}

/// The folder as an absolute path with no symbolic links, which is how
/// bindings store it. A missing path or a file is refused.
pub fn canonical_folder(path: &Path) -> Result<PathBuf, AgboardError> {
    let refused = || AgboardError::InvalidValue {
        field: "--folder".to_string(),
        reason: "Use an existing folder.".to_string(),
    };
    let canonical = fs::canonicalize(path).map_err(|_| refused())?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(refused())
    }
}

impl FileStore {
    /// `bindings.json` beside the shared folder, in the data directory.
    fn bindings_path(&self) -> PathBuf {
        self.shared_dir()
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."))
            .join(BINDINGS_FILE)
    }

    fn bindings_lock_path(&self) -> PathBuf {
        self.bindings_path().with_file_name(BINDINGS_LOCK)
    }

    /// Every binding. A missing file has none. A file that does not follow
    /// the format is an error, never silently taken as empty.
    pub fn bindings(&self) -> Result<Vec<Binding>, AgboardError> {
        let path = self.bindings_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let text = io::read_text(&path, BINDINGS_FILE)?;
        let file: BindingsFile =
            serde_json::from_str(&text).map_err(|e| AgboardError::FileInvalid {
                file: BINDINGS_FILE.to_string(),
                field: String::new(),
                reason: e.to_string(),
            })?;
        if file.format_version != FORMAT_VERSION {
            return Err(AgboardError::FormatUnsupported {
                file: BINDINGS_FILE.to_string(),
                version: file.format_version.to_string(),
            });
        }
        file.bindings
            .into_iter()
            .map(|entry| {
                let project_id = entry.project_id.parse::<ProjectId>().map_err(|_| {
                    AgboardError::FileInvalid {
                        file: BINDINGS_FILE.to_string(),
                        field: entry.project_id.clone(),
                        reason: "The project ID is not valid.".to_string(),
                    }
                })?;
                Ok(Binding {
                    project_id,
                    folder: entry.folder,
                })
            })
            .collect()
    }

    fn write_bindings(&self, bindings: &[Binding]) -> Result<(), AgboardError> {
        let file = BindingsFile {
            format_version: FORMAT_VERSION,
            bindings: bindings
                .iter()
                .map(|b| BindingEntry {
                    project_id: b.project_id.as_str().to_string(),
                    folder: b.folder.clone(),
                })
                .collect(),
        };
        io::write_json(&self.bindings_path(), &file, BINDINGS_FILE)
    }

    /// The binding of this folder, if its project still exists. A binding
    /// whose project was deleted no longer holds the folder.
    pub fn live_binding_for_folder(&self, folder: &Path) -> Result<Option<Binding>, AgboardError> {
        let projects = reader::list_projects(self.shared_dir())?;
        Ok(self
            .bindings()?
            .into_iter()
            .find(|b| b.folder == folder && projects.iter().any(|p| p.id == b.project_id)))
    }

    /// Bind a folder to a project under the bindings lock. Binding a folder to
    /// the project it already belongs to changes nothing. A folder that belongs
    /// to a project which still exists is refused, and nothing is written. A
    /// binding whose project was deleted gives way to the new one.
    pub fn bind_folder(
        &self,
        id: &ProjectId,
        folder: &Path,
    ) -> Result<Changed<Binding>, AgboardError> {
        let _lock = WriteLock::acquire(&self.bindings_lock_path())?;
        let mut bindings = self.bindings()?;
        let projects = reader::list_projects(self.shared_dir())?;
        if let Some(existing) = bindings.iter().find(|b| b.folder == folder).cloned() {
            if existing.project_id == *id {
                return Ok(Changed {
                    value: existing,
                    changed: false,
                });
            }
            if projects.iter().any(|p| p.id == existing.project_id) {
                return Err(AgboardError::FolderBoundElsewhere {
                    folder: folder.display().to_string(),
                });
            }
            bindings.retain(|b| b.folder != folder);
        }
        let binding = Binding {
            project_id: id.clone(),
            folder: folder.to_path_buf(),
        };
        bindings.push(binding.clone());
        self.write_bindings(&bindings)?;
        Ok(Changed {
            value: binding,
            changed: true,
        })
    }

    /// The project a folder works on: the binding of the nearest bound folder
    /// that contains `start`. Nothing is guessed. No binding, an unreadable
    /// folder, or a bound project that no longer exists is an error.
    pub fn project_for_folder(&self, start: &Path) -> Result<ProjectMeta, AgboardError> {
        let shown = start.display().to_string();
        let unbound = || AgboardError::FolderUnbound {
            folder: shown.clone(),
        };
        let start = fs::canonicalize(start).map_err(|_| unbound())?;
        let nearest = self
            .bindings()?
            .into_iter()
            .filter(|b| start.starts_with(&b.folder))
            .max_by_key(|b| b.folder.components().count())
            .ok_or_else(unbound)?;
        reader::list_projects(self.shared_dir())?
            .into_iter()
            .find(|project| project.id == nearest.project_id)
            .ok_or(AgboardError::BoundProjectMissing { folder: shown })
    }
}
