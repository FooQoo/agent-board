//! The project folder, `workspace.json`, the project list and `project.json`.

use super::files::parse_file;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use crate::domain::{ProjectId, ProjectMeta};
use crate::error::AgboardError;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{ProjectFile, WorkspaceFile};
use crate::file_store::validate;

/// The project folder, or `project_not_found` when it does not exist.
pub fn project_dir_checked(shared: &Path, id: &ProjectId) -> Result<PathBuf, AgboardError> {
    let dir = layout::project_dir(shared, id);
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        })
    }
}

/// Whether `workspace.json` exists. A present file must pass every check.
pub fn workspace_present(shared: &Path) -> Result<bool, AgboardError> {
    let path = layout::workspace_file(shared);
    if !path.is_file() {
        return Ok(false);
    }
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: WorkspaceFile = parse_file(&bytes, &label)?;
    match validate::check_workspace(&file).into_iter().next() {
        None => Ok(true),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Every project, sorted by name (binary order). A project whose file is
/// defective fails the whole list.
pub fn list_projects(shared: &Path) -> Result<Vec<ProjectMeta>, AgboardError> {
    if !workspace_present(shared)? {
        return Ok(Vec::new());
    }
    let dir = layout::projects_dir(shared);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&dir).map_err(|e| io::read_error(&layout::shared_label(shared, &dir), e))?;
    let mut projects = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io::read_error(&layout::shared_label(shared, &dir), e))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(id) = ProjectId::from_str(name) else {
            continue;
        };
        if !path.is_dir() {
            continue;
        }
        match read_project_file(shared, &id) {
            Ok(file) => projects.push(meta_of(file)),
            // A project deleted while the folder was being read is left out:
            // the list shows it before or after the deletion, never half of it.
            Err(_) if !path.is_dir() => continue,
            Err(error) => return Err(error),
        }
    }
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(projects)
}

pub(crate) fn meta_of(file: ProjectFile) -> ProjectMeta {
    ProjectMeta {
        id: file.id,
        name: file.name,
        created_at: file.created_at,
    }
}

/// Read and check `project.json` of a project.
pub fn read_project_file(shared: &Path, id: &ProjectId) -> Result<ProjectFile, AgboardError> {
    let dir = project_dir_checked(shared, id)?;
    let path = layout::project_file(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: ProjectFile = parse_file(&bytes, &label)?;
    match validate::check_project(&file, id.as_str())
        .into_iter()
        .next()
    {
        None => Ok(file),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}
