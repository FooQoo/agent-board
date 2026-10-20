//! Paths inside the shared directory. The functions here name paths and check
//! the IDs that go into them; the one exception is `has_symlink_below`, which
//! reads link metadata so that owned files are never reached through a link.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::validate::{self, EpicId};
use crate::domain::ProjectId;
use crate::error::AgboardError;

/// The `format` value written to `workspace.json`.
pub const FORMAT_NAME: &str = "agboard-files";
/// The only `formatVersion` this build reads and writes.
pub const FORMAT_VERSION: u32 = 1;

pub fn workspace_file(shared: &Path) -> PathBuf {
    shared.join("workspace.json")
}

/// The lock that serializes project creation, so project names stay unique.
pub fn catalog_lock(shared: &Path) -> PathBuf {
    shared.join(".internal").join("catalog.lock")
}

pub fn projects_dir(shared: &Path) -> PathBuf {
    shared.join("projects")
}

pub fn project_dir(shared: &Path, id: &ProjectId) -> PathBuf {
    projects_dir(shared).join(id.as_str())
}

pub fn project_file(project_dir: &Path) -> PathBuf {
    project_dir.join("project.json")
}

pub fn readme_file(project_dir: &Path) -> PathBuf {
    project_dir.join("README.md")
}

pub fn tasks_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("tasks")
}

pub fn epics_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("epics")
}

pub fn task_dir(project_dir: &Path, task_id: i64) -> PathBuf {
    tasks_dir(project_dir).join(task_id.to_string())
}

pub fn task_json(task_dir: &Path) -> PathBuf {
    task_dir.join("task.json")
}

pub fn task_md(task_dir: &Path) -> PathBuf {
    task_dir.join("TASK.md")
}

/// The project's write lock. It lives in `.internal/`, which is not canonical data.
pub fn write_lock(project_dir: &Path) -> PathBuf {
    project_dir.join(".internal").join("write.lock")
}

/// The path of `path` relative to the shared directory, with `/` separators.
/// This is the form used in errors, for example `projects/<id>/tasks/1/task.json`.
pub fn shared_label(shared: &Path, path: &Path) -> String {
    relative_label(shared, path)
}

/// The path of `path` relative to a project folder, with `/` separators.
/// This is the form used in `problems`, for example `tasks/1/TASK.md`.
pub fn project_label(project_dir: &Path, path: &Path) -> String {
    relative_label(project_dir, path)
}

fn relative_label(base: &Path, path: &Path) -> String {
    match path.strip_prefix(base) {
        Ok(rest) => rest
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
        Err(_) => path.display().to_string(),
    }
}

pub fn epic_dir(project_dir: &Path, id: &EpicId) -> PathBuf {
    epics_dir(project_dir).join(id.as_str())
}

/// `epic.json` inside an epic folder.
pub fn epic_file(epic_dir: &Path) -> PathBuf {
    epic_dir.join("epic.json")
}

/// `EPIC.md` inside an epic folder.
pub fn epic_document(epic_dir: &Path) -> PathBuf {
    epic_dir.join("EPIC.md")
}

/// The `assets/` folder of an owner (a task folder or an epic folder).
pub fn assets_dir(owner_dir: &Path) -> PathBuf {
    owner_dir.join("assets")
}

/// The file extension of a stored image, by its media type. `None` for a type
/// that is not an accepted image.
pub fn asset_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

/// `tasks/<task-id>/assets/<attachment-id>.<ext>`. The ID is checked first.
pub fn task_asset_path(
    project_dir: &Path,
    task_id: i64,
    attachment_id: &str,
    ext: &str,
) -> Result<PathBuf, AgboardError> {
    check_task_id(task_id)?;
    asset_file(&task_dir(project_dir, task_id), attachment_id, ext)
}

/// `epics/<EPIC-ID>/assets/<attachment-id>.<ext>`. The ID is checked first.
pub fn epic_asset_path(
    project_dir: &Path,
    epic: &EpicId,
    attachment_id: &str,
    ext: &str,
) -> Result<PathBuf, AgboardError> {
    asset_file(&epic_dir(project_dir, epic), attachment_id, ext)
}

fn asset_file(owner_dir: &Path, attachment_id: &str, ext: &str) -> Result<PathBuf, AgboardError> {
    validate::check_object_id(attachment_id, "attachmentId")?;
    if !matches!(ext, "png" | "jpg" | "webp" | "gif") {
        return Err(AgboardError::InvalidValue {
            field: "attachment".into(),
            reason: "Only PNG, JPEG, WebP, and GIF images are accepted.".into(),
        });
    }
    Ok(assets_dir(owner_dir).join(format!("{attachment_id}.{ext}")))
}

fn check_task_id(task_id: i64) -> Result<(), AgboardError> {
    if task_id < 1 {
        return Err(AgboardError::InvalidValue {
            field: "taskId".into(),
            reason: "Task IDs start at 1.".into(),
        });
    }
    Ok(())
}

/// Whether `path`, or a folder or file between `project_dir` and it, is a
/// symbolic link. A component that does not exist ends the walk with `false`.
/// `path` must lie inside `project_dir`.
pub fn has_symlink_below(project_dir: &Path, path: &Path) -> io::Result<bool> {
    let rest = path
        .strip_prefix(project_dir)
        .map_err(|e| io::Error::other(e.to_string()))?;
    let mut current = project_dir.to_path_buf();
    for part in rest.components() {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return Ok(true),
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e),
        }
    }
    Ok(false)
}

/// The task ID a folder name stands for. Only canonical positive decimal
/// names count (`1`, `12`); `01`, `0`, and dot-prefixed temporary folders do not.
pub fn parse_task_dir(name: &str) -> Option<i64> {
    let canonical =
        !name.is_empty() && name.bytes().all(|b| b.is_ascii_digit()) && !name.starts_with('0');
    if !canonical {
        return None;
    }
    name.parse::<i64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_folder_names_must_be_canonical_positive_integers() {
        assert_eq!(parse_task_dir("1"), Some(1));
        assert_eq!(parse_task_dir("12"), Some(12));
        for bad in ["", "0", "01", "-1", "1a", ".new-1", " 1"] {
            assert_eq!(parse_task_dir(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn labels_are_relative_with_forward_slashes() {
        let shared = Path::new("shared");
        let id: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        let dir = project_dir(shared, &id);
        assert_eq!(
            shared_label(shared, &task_json(&task_dir(&dir, 3))),
            "projects/0123456789abcdef0123456789abcdef/tasks/3/task.json"
        );
        assert_eq!(
            project_label(&dir, &task_md(&task_dir(&dir, 3))),
            "tasks/3/TASK.md"
        );
    }
}
