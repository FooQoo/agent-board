//! Writing the title and body of a task.

use std::path::Path;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::frontmatter::AcceptanceItem;
use crate::file_store::history::{ParseMode, compose_task, parse_task};
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::TaskFile;
use crate::file_store::reader;

/// Save the title and/or the body of a task under the lock. The body is
/// validated before anything is written. Returns whether either text changed.
/// The caller sets `updatedAt` and saves `task.json`.
pub(super) fn write_text(
    shared: &Path,
    project: &ProjectId,
    project_dir: &Path,
    task: &mut TaskFile,
    title: Option<String>,
    description: Option<String>,
) -> Result<(bool, Option<String>), AgboardError> {
    let current_body = reader::read_body(shared, project, task.id)?;
    let next_title = title.unwrap_or_else(|| task.title.clone());
    let next_body = description.unwrap_or_else(|| current_body.clone());
    let title_changed = next_title != task.title;
    let body_changed = next_body != current_body;
    if !title_changed && !body_changed {
        return Ok((false, None));
    }
    let mut replacement = None;
    if body_changed {
        let label = layout::shared_label(
            shared,
            &layout::task_md(&layout::task_dir(project_dir, task.id)),
        );
        crate::file_store::validate::ensure_task_body(&next_body, &label)?;
        let parts = crate::file_store::frontmatter::parse(&next_body);
        let composed = compose_task(
            &next_body,
            &parts.body,
            Some(&parts.acceptance),
            &task.history,
        )
        .map_err(|defect| AgboardError::FileInvalid {
            file: label.clone(),
            field: defect.field,
            reason: defect.reason,
        })?;
        replacement = Some(composed);
    }
    task.title = next_title;
    Ok((true, replacement))
}

pub(super) fn write_parts(
    shared: &Path,
    project_dir: &Path,
    task: &mut TaskFile,
    body: Option<&str>,
    acceptance: Option<&[AcceptanceItem]>,
) -> Result<Option<String>, AgboardError> {
    if body.is_none() && acceptance.is_none() {
        return Ok(None);
    }
    let md_path = layout::task_md(&layout::task_dir(project_dir, task.id));
    let label = layout::shared_label(shared, &md_path);
    let original = io::read_text(&md_path, &label)?;
    let parsed = parse_task(&original, ParseMode::Stored);
    if let Some(defect) = parsed.history_defects.first() {
        return Err(AgboardError::FileInvalid {
            file: label,
            field: defect.field.clone(),
            reason: defect.reason.clone(),
        });
    }
    let next_body = body.unwrap_or(&parsed.body).replace("\r\n", "\n");
    crate::domain::normalize_and_validate_description(&next_body)?;
    let composed =
        compose_task(&original, &next_body, acceptance, &task.history).map_err(|defect| {
            AgboardError::FileInvalid {
                file: label.clone(),
                field: defect.field,
                reason: defect.reason,
            }
        })?;
    Ok((composed != original).then_some(composed))
}
