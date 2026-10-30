//! Epic operations: creation under a temporary folder, the update of the
//! metadata and the document, deletion refused while tasks refer to the epic, and
//! the epic of a task. Every write holds the project's write lock.

mod edit;
mod membership;
mod seed;

use std::path::{Path, PathBuf};

use super::super::frontmatter;
use super::super::io;
use super::super::layout;
use super::super::model::{EpicFile, EpicView};
use super::super::reader;
use super::super::validate::{self, EpicId};
use crate::domain::ProjectId;
use crate::error::AgboardError;

/// The epic folder and its `epic.json`, read strictly. A missing folder is
/// `epic_not_found`; a defect in the file is `file_invalid`.
pub(super) fn read_epic_file(
    shared: &Path,
    project: &ProjectId,
    id: &EpicId,
) -> Result<(PathBuf, EpicFile), AgboardError> {
    let project_dir = reader::project_dir_checked(shared, project)?;
    let dir = layout::epic_dir(&project_dir, id);
    if !dir.is_dir() {
        return Err(AgboardError::EpicNotFound { id: id.to_string() });
    }
    let path = layout::epic_file(&dir);
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: EpicFile = reader::parse_file(&bytes, &label)?;
    match validate::check_epic(&file, id.as_str()).into_iter().next() {
        None => Ok((dir, file)),
        Some(d) => Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        }),
    }
}

fn read_document(shared: &Path, dir: &Path) -> Result<String, AgboardError> {
    let path = layout::epic_document(dir);
    io::read_text(&path, &layout::shared_label(shared, &path))
}

fn view_of(file: EpicFile, document: String) -> EpicView {
    let parts = frontmatter::parse_document(&document);
    let (priority, priority_error) = match frontmatter::priority_of(&document) {
        Ok(order) => (order, false),
        Err(_) => (Vec::new(), true),
    };
    EpicView {
        id: file.id,
        name: file.name,
        color: file.color,
        is_draft: file.is_draft,
        document,
        body: parts.body,
        priority,
        priority_error,
        attachments: file.attachments,
        created_at: file.created_at,
        updated_at: file.updated_at,
    }
}

/// An epic as it is stored: `epic.json` and EPIC.md read together.
pub(super) fn epic_view(
    shared: &Path,
    project: &ProjectId,
    id: &EpicId,
) -> Result<EpicView, AgboardError> {
    let (dir, file) = read_epic_file(shared, project, id)?;
    let document = read_document(shared, &dir)?;
    Ok(view_of(file, document))
}

/// A `#RRGGBB` color that none of `used` has. The color is random; a collision
/// is drawn again, so a saved color is never handed out twice.
fn random_color<'a>(used: impl Iterator<Item = &'a str> + Clone) -> Result<String, AgboardError> {
    for _ in 0..1_000 {
        let hex = io::random_hex(3).map_err(|e| io::write_error("epic.json", e))?;
        let color = format!("#{}", hex.to_ascii_uppercase());
        if !used.clone().any(|saved| saved.eq_ignore_ascii_case(&color)) {
            return Ok(color);
        }
    }
    Err(io::write_error("epic.json", "no free color could be drawn"))
}

fn save_epic(shared: &Path, dir: &Path, file: &EpicFile) -> Result<(), AgboardError> {
    let path = layout::epic_file(dir);
    io::write_json(&path, file, &layout::shared_label(shared, &path))
}

fn save_document(shared: &Path, dir: &Path, text: &str) -> Result<(), AgboardError> {
    let path = layout::epic_document(dir);
    io::write_atomic(&path, text.as_bytes(), &layout::shared_label(shared, &path))
}

/// The document to store: the given text with CRLF folded, or the template when
/// no text (or only whitespace) is given.
fn document_to_store(document: Option<String>) -> Result<String, AgboardError> {
    match document {
        Some(text) if !text.trim().is_empty() => validate::normalize_document(&text),
        _ => Ok(validate::document_template()),
    }
}
