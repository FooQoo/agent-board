//! Checks of the TASK.md and EPIC.md text, and the question and answer text rules.

use super::Defect;
use crate::domain::{MAX_ANSWER_TEXT_CHARS, MAX_QUESTION_CHARS};
use crate::error::AgboardError;
use crate::file_store::frontmatter;

/// The TASK.md written when a task is created without a body.
pub fn task_template() -> String {
    "---\nacceptance: []\n---\n\n".to_string()
}

/// Check a TASK.md text: its frontmatter. The body is not checked.
pub fn check_task_body(text: &str) -> Vec<Defect> {
    frontmatter::parse(text).defects
}

/// Check an EPIC.md text's metadata syntax, without interpreting conditions.
pub fn check_document_body(text: &str) -> Vec<Defect> {
    frontmatter::parse_document(text).defects
}

/// Turn the first defect of a TASK.md text into a `file_invalid` error.
/// `file` is the path shown to the caller (relative to the shared directory).
pub fn ensure_task_body(text: &str, file: &str) -> Result<(), AgboardError> {
    first_defect_error(check_task_body(text), file)
}

/// The EPIC.md form of `ensure_task_body`.
pub fn ensure_document_body(text: &str, file: &str) -> Result<(), AgboardError> {
    first_defect_error(check_document_body(text), file)
}

fn first_defect_error(defects: Vec<Defect>, file: &str) -> Result<(), AgboardError> {
    match defects.into_iter().next() {
        None => Ok(()),
        Some(d) => Err(AgboardError::FileInvalid {
            file: file.to_string(),
            field: d.field,
            reason: d.reason,
        }),
    }
}

/// Normalize line endings (CRLF to LF), trim the outer whitespace, and require
/// 1 to 5,000 characters. This is the rule of a decision request's question.
pub fn normalize_question(text: &str) -> Result<String, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_QUESTION_CHARS {
        return Err(AgboardError::InvalidValue {
            field: "question".into(),
            reason: "Questions must be 1 to 5000 characters.".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// Normalize a free-text answer. Blank text counts as no text (`None`). Text
/// over 2,000 characters is `InvalidValue`.
pub fn normalize_answer_text(text: &str) -> Result<Option<String>, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_ANSWER_TEXT_CHARS {
        return Err(AgboardError::InvalidValue {
            field: "text".into(),
            reason: "Answers must be 2,000 characters or fewer.".into(),
        });
    }
    Ok(Some(trimmed.to_string()))
}
