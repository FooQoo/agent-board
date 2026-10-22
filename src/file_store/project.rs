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
use crate::domain::BoardMeta;
use crate::domain::{Changed, ProjectId, ProjectMeta, validate_project_name};
use crate::error::AgboardError;

/// The README written into each new project folder: the entry point for
/// people and agents who edit the shared files directly.
pub fn readme_text() -> String {
    "# Project files\n\
\n\
This folder is one Agent Board project. Its state is kept in these files.\n\
\n\
- `project.json`: the project ID, name, creation time, and the next task number. Do not edit it; use the `agboard` CLI.\n\
- `tasks/<task-id>/task.json`: a task's metadata such as its current status and assignee. Do not edit it; use the `agboard` CLI.\n\
- `tasks/<task-id>/TASK.md`: a task's body, acceptance conditions, and operation history. TASK.md history is the source of truth for task operation history.\n\
- `epics/<epic-id>/epic.json`: an epic's fields. Do not edit it; use the `agboard` CLI.\n\
- `epics/<epic-id>/EPIC.md`: an epic's document. Write a temporary file in the same folder and rename it over EPIC.md.\n\
- `.internal/`: lock files. Do not edit or delete them.\n\
\n\
TASK.md frontmatter holds its `acceptance` completion conditions and `history` entries containing only `at` and a nonempty `reason`; new tasks accept an empty list and Agent Board adds a creation note.\n\
Each condition is an item with `id` (AC-n), `text`, and `done` (true or false), for example:\n\
`---`, `acceptance:`, `  - id: AC-1`, `    text: The list is returned as JSON`, `    done: false`, `---`.\n\
The body after the frontmatter is free Markdown. EPIC.md uses only `priority` for managed metadata; write epic reference conditions directly in its body. Other keys in the frontmatter are kept. For tasks, the `history` list is written by Agent Board when operations occur; ordinary body and acceptance edits preserve it.\n\
Every JSON file uses `formatVersion: 1`. Files with any other version or with unknown fields are reported and are not migrated or read; Agent Board never converts or deletes them automatically.\n\
Do not edit TASK.md of a task that is a draft.\n\
Do not delete a task folder or an epic folder. Ask a person to delete a task or an epic with the `agboard` CLI.\n"
        .to_string()
}

/// Write `workspace.json` if it does not exist yet. A file that exists must pass.
pub(crate) fn ensure_workspace(shared: &std::path::Path) -> Result<(), AgboardError> {
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
    /// Create an empty project with a new ID and the next task number at 1.
    /// The name is trimmed and must be unique (case-sensitive) among projects.
    pub fn create_project(
        &self,
        name: &str,
        now: DateTime<Utc>,
    ) -> Result<ProjectMeta, AgboardError> {
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
            return Err(AgboardError::ProjectNameExists { name });
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
        let result = (|| -> Result<(), AgboardError> {
            fs::create_dir(&temp).map_err(|e| io::write_error(&label, e))?;
            fs::create_dir(layout::tasks_dir(&temp)).map_err(|e| io::write_error(&label, e))?;
            fs::create_dir(layout::epics_dir(&temp)).map_err(|e| io::write_error(&label, e))?;
            fs::create_dir(layout::docs_dir(&temp)).map_err(|e| io::write_error(&label, e))?;
            let file = ProjectFile {
                format_version: FORMAT_VERSION,
                id: id.clone(),
                name: name.clone(),
                created_at,
                next_task_id: 1,
                default_epics_seeded: false,
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
        // A failed seeding leaves the flag unset, so the next start offers the
        // default epics again; the new project itself is complete.
        let _ = self.seed_default_epics(&id, now);
        Ok(ProjectMeta {
            id,
            name,
            created_at,
        })
    }
}

impl FileStore {
    /// Create the `docs/` folder of every project that lacks one. A folder that
    /// exists is left as it is, content included. A failure is skipped: the
    /// Docs reads treat a missing folder as empty.
    pub fn ensure_docs_dirs(&self) {
        let shared = self.shared_dir();
        for id in crate::file_store::index::scan_ids(shared).unwrap_or_default() {
            let docs = layout::docs_dir(&layout::project_dir(shared, &id));
            if !docs.exists() {
                let _ = fs::create_dir(&docs);
            }
        }
    }

    /// Rename a project. The ID and the tasks do not change. The name is
    /// trimmed and checked against the other projects' names under the catalog
    /// lock; a name equal to the current one changes nothing.
    pub fn rename_project(
        &self,
        id: &ProjectId,
        new_name: &str,
    ) -> Result<Changed<ProjectMeta>, AgboardError> {
        let new_name = validate_project_name(new_name)?;
        let shared = self.shared_dir();
        let _catalog = WriteLock::acquire(&layout::catalog_lock(shared))?;
        let dir = reader::project_dir_checked(shared, id)?;
        let _project = WriteLock::acquire(&layout::write_lock(&dir))?;
        let mut file = reader::read_project_file(shared, id)?;
        if file.name == new_name {
            return Ok(Changed {
                value: reader::meta_of(file),
                changed: false,
            });
        }
        let taken = reader::list_projects(shared)?
            .iter()
            .any(|project| project.id != *id && project.name == new_name);
        if taken {
            return Err(AgboardError::ProjectNameExists { name: new_name });
        }
        file.name = new_name;
        let path = layout::project_file(&dir);
        io::write_json(&path, &file, &layout::shared_label(shared, &path))?;
        Ok(Changed {
            value: reader::meta_of(file),
            changed: true,
        })
    }

    /// Delete a project and all its tasks. The folder is first renamed out of
    /// the projects folder, so it disappears from the list in one step, then
    /// removed. Other projects are not touched.
    pub fn delete_project(&self, id: &ProjectId) -> Result<(), AgboardError> {
        let shared = self.shared_dir();
        let _catalog = WriteLock::acquire(&layout::catalog_lock(shared))?;
        let dir = reader::project_dir_checked(shared, id)?;
        let _project = WriteLock::acquire(&layout::write_lock(&dir))?;
        let projects = layout::projects_dir(shared);
        let label = layout::shared_label(shared, &dir);
        let trash = projects.join(format!(
            ".deleting-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        fs::rename(&dir, &trash).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(&projects).map_err(|e| io::write_error(&label, e))?;
        fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))
    }
}

impl FileStore {
    /// Empty one project's board. The ID, name, creation time and next task
    /// number stay, so task numbers are never reused. The tasks and epics
    /// folders are moved aside and replaced by empty ones. `changed` is false
    /// when there was nothing to remove.
    pub fn reset_project(&self, id: &ProjectId) -> Result<Changed<BoardMeta>, AgboardError> {
        let shared = self.shared_dir();
        let (dir, _project) = super::ops::lock_project(shared, id)?;
        let file = reader::read_project_file(shared, id)?;
        let board = BoardMeta {
            name: file.name.clone(),
            next_task_id: file.next_task_id,
            created_at: file.created_at,
        };
        let had_content = !reader::task_ids(&dir)?.is_empty()
            || fs::read_dir(layout::epics_dir(&dir))
                .map(|mut entries| entries.next().is_some())
                .unwrap_or(false);
        for folder in [layout::tasks_dir(&dir), layout::epics_dir(&dir)] {
            let label = layout::shared_label(shared, &folder);
            let trash = dir.join(format!(
                ".deleting-{}",
                io::random_hex(16).map_err(|e| io::write_error(&label, e))?
            ));
            if folder.exists() {
                fs::rename(&folder, &trash).map_err(|e| io::write_error(&label, e))?;
            }
            fs::create_dir(&folder).map_err(|e| io::write_error(&label, e))?;
            io::sync_dir(&dir).map_err(|e| io::write_error(&label, e))?;
            if trash.exists() {
                fs::remove_dir_all(&trash).map_err(|e| io::write_error(&label, e))?;
            }
        }
        Ok(Changed {
            value: board,
            changed: had_content,
        })
    }
}
