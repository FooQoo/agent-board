//! One-time move of an epic's document from its earlier file name to `EPIC.md`.
//!
//! The move runs under the project write lock before the project is read. It
//! renames the file inside its own folder, so each epic changes atomically and
//! with its bytes untouched. A run that stops part way is finished by the next
//! run, and an epic that already has `EPIC.md` is never changed. When both
//! files exist, nothing is moved: the conflict is reported with both paths.

use std::fs;
use std::path::{Path, PathBuf};

use super::io;
use super::layout;
use crate::error::AgboardError;

/// The file name an epic document had before it was called `EPIC.md`.
const PREVIOUS_NAME: &str = "PLAN.md";

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Rename every epic's earlier document file to `EPIC.md`. The caller holds the
/// project write lock. Nothing is moved while any epic is in conflict.
pub(crate) fn migrate_epic_documents(
    shared: &Path,
    project_dir: &Path,
) -> Result<(), AgboardError> {
    let epics = layout::epics_dir(project_dir);
    let epics_label = layout::shared_label(shared, &epics);
    let entries = match fs::read_dir(&epics) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io::read_error(&epics_label, error)),
    };
    let mut folders: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            (!name.starts_with('.') && entry.path().is_dir()).then(|| (name, entry.path()))
        })
        .collect();
    folders.sort();

    let mut pending = Vec::new();
    for (name, folder) in &folders {
        let previous = folder.join(PREVIOUS_NAME);
        if !exists(&previous) {
            continue;
        }
        let current = layout::epic_document(folder);
        let previous_label = layout::shared_label(shared, &previous);
        let current_label = layout::shared_label(shared, &current);
        if exists(&current) {
            return Err(AgboardError::FileInvalid {
                file: current_label.clone(),
                field: String::new(),
                reason: format!(
                    "Epic {name} has both {previous_label} and {current_label}. Neither file was changed. Compare them, keep the one you want as {current_label}, and remove the other by hand."
                ),
            });
        }
        if !previous.is_file() {
            return Err(AgboardError::FileInvalid {
                file: previous_label,
                field: String::new(),
                reason: format!("The epic document of {name} is not a regular file."),
            });
        }
        pending.push((folder, previous, current, previous_label));
    }

    for (folder, previous, current, label) in pending {
        fs::rename(&previous, &current).map_err(|e| io::write_error(&label, e))?;
        io::sync_dir(folder).map_err(|e| io::write_error(&label, e))?;
    }
    Ok(())
}
