use crate::error::SkanError;

const NAME_MAX: usize = 50;
const TITLE_MAX: usize = 100;
const REASON_MAX: usize = 100;
const DESCRIPTION_MAX: usize = 300;

fn invalid(field: &str, reason: impl Into<String>) -> SkanError {
    SkanError::InvalidValue {
        field: field.to_string(),
        reason: reason.into(),
    }
}

/// Trim, then require 1..=`max` Unicode scalar values on a single line.
fn one_line(value: &str, max: usize) -> Option<String> {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > max || trimmed.contains(['\n', '\r']) {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn validate_board_name(value: &str) -> Result<String, SkanError> {
    one_line(value, NAME_MAX).ok_or_else(|| {
        invalid(
            "name",
            "Board names must be 1 to 50 characters on one line.",
        )
    })
}

/// Project names follow the same rule as board names: trimmed, 1 to 50 Unicode
/// scalar values, one line.
pub fn validate_project_name(value: &str) -> Result<String, SkanError> {
    one_line(value, NAME_MAX).ok_or_else(|| {
        invalid(
            "name",
            "Project names must be 1 to 50 characters on one line.",
        )
    })
}

pub fn validate_title(value: &str) -> Result<String, SkanError> {
    one_line(value, TITLE_MAX)
        .ok_or_else(|| invalid("title", "Titles must be 1 to 100 characters on one line."))
}

/// Convert CRLF to LF, then require at most 300 Unicode scalar values.
/// Surrounding whitespace is kept.
pub fn normalize_and_validate_description(value: &str) -> Result<String, SkanError> {
    let normalized = value.replace("\r\n", "\n");
    let count = normalized.chars().count();
    if count > DESCRIPTION_MAX {
        return Err(invalid(
            "description",
            format!("Descriptions must be 300 characters or fewer. This one has {count}."),
        ));
    }
    Ok(normalized)
}

pub fn validate_reason(value: &str) -> Result<String, SkanError> {
    one_line(value, REASON_MAX)
        .ok_or_else(|| invalid("reason", "Reasons must be 1 to 100 characters on one line."))
}
