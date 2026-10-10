//! Paths inside the shared directory. Every function here only names a path;
//! none of them touches the file system.

use std::path::{Path, PathBuf};

use crate::domain::ProjectId;

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

pub fn task_dir(project_dir: &Path, card_id: i64) -> PathBuf {
    tasks_dir(project_dir).join(card_id.to_string())
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

/// The card ID a folder name stands for. Only canonical positive decimal
/// names count (`1`, `12`); `01`, `0`, and dot-prefixed temporary folders do not.
pub fn parse_card_dir(name: &str) -> Option<i64> {
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
    fn card_folder_names_must_be_canonical_positive_integers() {
        assert_eq!(parse_card_dir("1"), Some(1));
        assert_eq!(parse_card_dir("12"), Some(12));
        for bad in ["", "0", "01", "-1", "1a", ".new-1", " 1"] {
            assert_eq!(parse_card_dir(bad), None, "{bad:?}");
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
