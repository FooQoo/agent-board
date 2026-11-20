//! Checks and derived values of the text a result carries: the cleaned fields, the content key of
//! a delivery, and the history excerpt.

use sha2::{Digest, Sha256};

use super::result::{MAX_RESULT_KEY_CHARS, MAX_RESULT_TEXT_CHARS};
use crate::domain::{AttachmentInput, MAX_RESULT_TITLE_CHARS, ResultKind};
use crate::error::AgboardError;

pub(super) fn invalid(field: &str, reason: &str) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.into(),
        reason: reason.into(),
    }
}

pub(super) fn clean_text(field: &str, value: &str) -> Result<String, AgboardError> {
    let text = value.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim();
    let count = text.chars().count();
    if count == 0 || count > MAX_RESULT_TEXT_CHARS {
        return Err(invalid(
            field,
            &format!("A {field} must be 1 to {MAX_RESULT_TEXT_CHARS} characters."),
        ));
    }
    Ok(text.to_owned())
}

pub(super) fn clean_title(value: &str) -> Result<String, AgboardError> {
    let title = value.trim();
    let count = title.chars().count();
    if count == 0 || count > MAX_RESULT_TITLE_CHARS {
        return Err(invalid(
            "title",
            &format!("A title must be 1 to {MAX_RESULT_TITLE_CHARS} characters."),
        ));
    }
    if title.chars().any(char::is_control) {
        return Err(invalid("title", "A title must be on one line."));
    }
    Ok(title.to_owned())
}

pub(super) fn clean_link(value: &str) -> Result<String, AgboardError> {
    let link = clean_text("link", value)?;
    if link.chars().any(char::is_control) {
        return Err(invalid("link", "A link must be on one line."));
    }
    Ok(link)
}

pub(super) fn clean_key(value: &str) -> Result<String, AgboardError> {
    let key = value.trim();
    let valid = !key.is_empty()
        && key.chars().count() <= MAX_RESULT_KEY_CHARS
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'));
    if !valid {
        return Err(invalid(
            "key",
            "A key must be 1 to 64 characters of letters, digits, '.', '_', ':' and '-'.",
        ));
    }
    Ok(key.to_owned())
}

/// 32 lowercase hex digits taken from the content of a delivery.
pub(super) fn content_key(
    kind: ResultKind,
    summary: &str,
    link: Option<&str>,
    images: &[AttachmentInput],
) -> String {
    let mut hash = Sha256::new();
    hash.update(kind.as_str().as_bytes());
    for part in [Some(summary), link] {
        hash.update([0]);
        hash.update(part.unwrap_or("").as_bytes());
    }
    // The separator before the image part is always written, so a result without
    // images and a result with one image keep the keys they had before several
    // images were allowed.
    hash.update([0]);
    for (index, image) in images.iter().enumerate() {
        if index > 0 {
            hash.update([0]);
        }
        hash.update(Sha256::digest(&image.bytes));
    }
    hash.finalize()[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The first line of the summary, cut to a length a history entry can carry.
pub(super) fn excerpt(summary: &str) -> String {
    let line = summary.lines().next().unwrap_or("").trim();
    if line.chars().count() > 200 {
        let cut: String = line.chars().take(199).collect();
        format!("{cut}…")
    } else {
        line.to_owned()
    }
}
