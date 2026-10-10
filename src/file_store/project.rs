//! Project creation. The name check and the new folder are done under the
//! catalog lock, so two creations of one name cannot both succeed.
//! The folder is built under a temporary name and renamed into place, so a
//! failure leaves no half-made project.

use std::fs;

use chrono::{DateTime, Utc};

use super::FileStore;
use super::io;
use super::layout::{self, FORMAT_NAME, FORMAT_VERSION};
use super::lock::WriteLock;
use super::model::{ProjectFile, WorkspaceFile};
use super::reader;
use crate::clock::{format_utc, parse_utc};
use crate::domain::{ProjectId, ProjectMeta, validate_project_name};
use crate::error::SkanError;

/// The README written into each new project folder: the entry point for
/// people and agents who edit the shared files directly.
pub fn readme_text() -> String {
    "# Project files\n\
\n\
This folder is one Agent Board project. Its state is kept in these files.\n\
\n\
- `project.json`: the project ID, name, creation time, and the next card number. Do not edit it.\n\
- `tasks/<card-id>/task.json`: a card's state and history. Do not edit it; use the `agboard` CLI.\n\
- `tasks/<card-id>/TASK.md`: a card's text. You may edit it. Write a temporary file in the same folder and rename it over TASK.md.\n\
- `.internal/`: lock files. Do not edit or delete them.\n\
\n\
Keep the required headings in TASK.md: `## 作業内容`, `## 完了条件と確認結果`, and `## 実行記録`.\n\
A completion condition is written as `- [ ] AC-n. text`, followed by the lines `- 確認結果:`, `- 根拠:`, and `- 調整役の確認:`.\n\
Do not edit TASK.md of a card that is a draft.\n"
        .to_string()
}

/// Write `workspace.json` if it does not exist yet. A file that exists must pass.
pub(crate) fn ensure_workspace(shared: &std::path::Path) -> Result<(), SkanError> {
    if reader::workspace_present(shared)? {
        return Ok(());
    }
    let file = WorkspaceFile {
        format: FORMAT_NAME.to_string(),
        format_version: FORMAT_VERSION,
    };
    io::write_json(&layout::workspace_file(shared), &file, "workspace.json")
}

impl FileStore {
    /// Create an empty project with a new ID and the next card number at 1.
    /// The name is trimmed and must be unique (case-sensitive) among projects.
    pub fn create_project(&self, name: &str, now: DateTime<Utc>) -> Result<ProjectMeta, SkanError> {
        let name = validate_project_name(name)?;
        let id = ProjectId::generate()?;
        let created_at = parse_utc(&format_utc(now)).unwrap_or(now);
        let shared = self.shared_dir();
        fs::create_dir_all(shared).map_err(|e| io::write_error("shared", e))?;

        let _catalog = WriteLock::acquire(&layout::catalog_lock(shared))?;
        if reader::list_projects(shared)?
            .iter()
            .any(|project| project.name == name)
        {
            return Err(SkanError::ProjectNameExists { name });
        }
        ensure_workspace(shared)?;

        let projects = layout::projects_dir(shared);
        fs::create_dir_all(&projects).map_err(|e| io::write_error("projects", e))?;
        let temp = projects.join(format!(
            ".new-{}",
            io::random_hex(16).map_err(|e| io::write_error("projects", e))?
        ));
        let target = layout::project_dir(shared, &id);
        let label = format!("projects/{}", id.as_str());
        let result = (|| -> Result<(), SkanError> {
            fs::create_dir(&temp).map_err(|e| io::write_error(&label, e))?;
            fs::create_dir(layout::tasks_dir(&temp)).map_err(|e| io::write_error(&label, e))?;
            fs::create_dir(layout::epics_dir(&temp)).map_err(|e| io::write_error(&label, e))?;
            let file = ProjectFile {
                format_version: FORMAT_VERSION,
                id: id.clone(),
                name: name.clone(),
                created_at,
                next_card_id: 1,
            };
            io::write_json(
                &layout::project_file(&temp),
                &file,
                &format!("{label}/project.json"),
            )?;
            io::write_atomic(
                &layout::readme_file(&temp),
                readme_text().as_bytes(),
                &format!("{label}/README.md"),
            )?;
            fs::rename(&temp, &target).map_err(|e| io::write_error(&label, e))?;
            io::sync_dir(&projects).map_err(|e| io::write_error(&label, e))
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&temp);
            return Err(error);
        }
        Ok(ProjectMeta {
            id,
            name,
            created_at,
        })
    }
}
