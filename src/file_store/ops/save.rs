//! Saving a task's `task.json` and `TASK.md` as one pair.

use std::path::Path;

use crate::error::AgboardError;
use crate::file_store::frontmatter::{self};
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::TaskFile;

pub(super) fn save_task(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
) -> Result<(), AgboardError> {
    save_task_with_markdown(shared, project_dir, task, None)
}

pub(super) fn save_task_with_markdown(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    replacement: Option<&str>,
) -> Result<(), AgboardError> {
    use crate::file_store::transaction::save_pair_locked;
    let (targets, old, new) = task_pair(shared, project_dir, task, replacement)?;
    save_pair_locked(project_dir, &targets, &old, &new)
}

/// The two files of a task as one change of a batch.
pub(super) fn task_pair_changes(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    replacement: Option<&str>,
) -> Result<Vec<crate::file_store::transaction::FileChange>, AgboardError> {
    use crate::file_store::transaction::FileChange;
    let (targets, old, new) = task_pair(shared, project_dir, task, replacement)?;
    Ok(vec![
        FileChange {
            target: targets.metadata,
            old: Some(old.metadata),
            new: Some(new.metadata),
        },
        FileChange {
            target: targets.markdown,
            old: Some(old.markdown),
            new: Some(new.markdown),
        },
    ])
}

/// The targets of a task's pair, their current bytes, and the bytes that hold `task`.
fn task_pair(
    shared: &Path,
    project_dir: &Path,
    task: &TaskFile,
    replacement: Option<&str>,
) -> Result<
    (
        crate::file_store::transaction::PairTargets,
        crate::file_store::transaction::PairBytes,
        crate::file_store::transaction::PairBytes,
    ),
    AgboardError,
> {
    use crate::file_store::history::{ParseMode, compose_task, parse_task};
    use crate::file_store::model::TaskMetadata;
    use crate::file_store::transaction::{PairBytes, PairTargets};

    let dir = layout::task_dir(project_dir, task.id);
    let json_path = layout::task_json(&dir);
    let md_path = layout::task_md(&dir);
    let json_label = layout::shared_label(shared, &json_path);
    let md_label = layout::shared_label(shared, &md_path);
    let old = PairBytes {
        metadata: io::read_bytes(&json_path, &json_label)?,
        markdown: io::read_bytes(&md_path, &md_label)?,
    };
    let text = std::str::from_utf8(&old.markdown).map_err(|_| {
        crate::error::AgboardError::FileUnreadable {
            file: md_label.clone(),
            reason: "the file is not valid UTF-8".into(),
        }
    })?;
    let parsed = parse_task(text, ParseMode::Stored);
    if let Some(defect) = parsed.history_defects.first() {
        return Err(AgboardError::FileInvalid {
            file: md_label,
            field: defect.field.clone(),
            reason: defect.reason.clone(),
        });
    }
    if task.history.len() < parsed.history.len()
        || task.history[..parsed.history.len()] != parsed.history
    {
        return Err(io::write_error(
            &json_label,
            "The task history changed before the operation could be saved.",
        ));
    }
    let markdown = if let Some(replacement) = replacement {
        let parts = frontmatter::parse(replacement);
        compose_task(replacement, &parts.body, None, &task.history)
            .map_err(|defect| AgboardError::FileInvalid {
                file: md_label.clone(),
                field: defect.field,
                reason: defect.reason,
            })?
            .into_bytes()
    } else if task.history == parsed.history {
        old.markdown.clone()
    } else {
        compose_task(text, &parsed.body, None, &task.history)
            .map_err(|defect| AgboardError::FileInvalid {
                file: md_label.clone(),
                field: defect.field,
                reason: defect.reason,
            })?
            .into_bytes()
    };
    let mut json = serde_json::to_vec_pretty(&TaskMetadata::from(task))
        .map_err(|error| io::write_error(&json_label, error))?;
    json.push(b'\n');
    Ok((
        PairTargets {
            metadata: std::path::PathBuf::from(format!("tasks/{}/task.json", task.id)),
            markdown: std::path::PathBuf::from(format!("tasks/{}/TASK.md", task.id)),
        },
        old,
        PairBytes {
            metadata: json,
            markdown,
        },
    ))
}
