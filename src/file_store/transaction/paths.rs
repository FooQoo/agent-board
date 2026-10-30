//! Validation of transaction targets and the journal folder, and reading a pair.

use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{PairBytes, PairTargets};
use crate::error::AgboardError;
use crate::file_store::io::write_error;

pub(super) fn label(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn validate_targets(project: &Path, targets: &PairTargets) -> Result<(), AgboardError> {
    let valid = |path: &Path, filename: &str| -> Option<String> {
        let parts: Vec<_> = path.components().collect();
        let [
            Component::Normal(tasks),
            Component::Normal(id),
            Component::Normal(name),
        ] = parts.as_slice()
        else {
            return None;
        };
        let id = id.to_str()?;
        if *tasks != "tasks"
            || *name != filename
            || id.parse::<i64>().ok().filter(|n| *n > 0).is_none()
            || id.starts_with('0')
            || !id.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Some(id.into())
    };
    let json = valid(&targets.metadata, "task.json");
    if json.is_none() || json != valid(&targets.markdown, "TASK.md") {
        return Err(write_error(
            ".internal/transactions",
            "Transaction targets must be task.json and TASK.md of the same task.",
        ));
    }
    for target in [&targets.metadata, &targets.markdown] {
        reject_symlinks(project, target)?;
    }
    Ok(())
}

pub(super) fn reject_symlinks(project: &Path, relative: &Path) -> Result<(), AgboardError> {
    let mut path = project.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(write_error(
                &label(relative),
                "Only relative normal path components are allowed.",
            ));
        }
        path.push(component.as_os_str());
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(write_error(
                    &label(relative),
                    "Transaction paths cannot contain symbolic links.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(write_error(&label(relative), error)),
        }
    }
    Ok(())
}

pub(super) fn journal_dir(project: &Path) -> Result<PathBuf, AgboardError> {
    let relative = Path::new(".internal/transactions");
    reject_symlinks(project, relative)?;
    Ok(project.join(relative))
}

pub(super) fn read_pair(project: &Path, targets: &PairTargets) -> Result<PairBytes, AgboardError> {
    Ok(PairBytes {
        metadata: fs::read(project.join(&targets.metadata))
            .map_err(|e| write_error(&label(&targets.metadata), e))?,
        markdown: fs::read(project.join(&targets.markdown))
            .map_err(|e| write_error(&label(&targets.markdown), e))?,
    })
}
