use crate::error::AgboardError;

pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_TASK_ATTACHMENTS: usize = 20;
pub const MAX_TASK_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;

/// Decision requests: at most this many choices, each with a label of at most
/// `MAX_CHOICE_LABEL_CHARS` and an ID of at most `MAX_CHOICE_ID_CHARS`.
pub const MAX_CHOICES: usize = 10;
pub const MAX_CHOICE_ID_CHARS: usize = 64;
pub const MAX_CHOICE_LABEL_CHARS: usize = 200;
/// A question, and a free-text answer, of at most this many characters.
pub const MAX_QUESTION_CHARS: usize = 2_000;
pub const MAX_ANSWER_TEXT_CHARS: usize = 2_000;

pub fn validate_attachment(
    id: &str,
    name: &str,
    bytes: &[u8],
) -> Result<&'static str, AgboardError> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(AgboardError::InvalidValue {
            field: "attachmentId".into(),
            reason: "Attachment IDs must be 32 lowercase hexadecimal characters.".into(),
        });
    }
    if name.is_empty() || name.rsplit(['/', '\\']).next().unwrap_or(name).is_empty() {
        return Err(AgboardError::InvalidValue {
            field: "name".into(),
            reason: "Attachment names must not be empty.".into(),
        });
    }
    if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AgboardError::InvalidValue {
            field: "attachment".into(),
            reason: "Images must be at most 10 MiB.".into(),
        });
    }
    let format = image::guess_format(bytes).map_err(|_| AgboardError::InvalidValue {
        field: "attachment".into(),
        reason: "Only PNG, JPEG, WebP, and GIF images are accepted.".into(),
    })?;
    let media_type = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => {
            return Err(AgboardError::InvalidValue {
                field: "attachment".into(),
                reason: "Only PNG, JPEG, WebP, and GIF images are accepted.".into(),
            });
        }
    };
    image::load_from_memory_with_format(bytes, format).map_err(|_| AgboardError::InvalidValue {
        field: "attachment".into(),
        reason: "The image is invalid.".into(),
    })?;
    Ok(media_type)
}

const NAME_MAX: usize = 50;
const TITLE_MAX: usize = 100;
const REASON_MAX: usize = 100;
const DESCRIPTION_MAX: usize = 50_000;

fn invalid(field: &str, reason: impl Into<String>) -> AgboardError {
    AgboardError::InvalidValue {
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

pub fn validate_board_name(value: &str) -> Result<String, AgboardError> {
    one_line(value, NAME_MAX).ok_or_else(|| {
        invalid(
            "name",
            "Board names must be 1 to 50 characters on one line.",
        )
    })
}

/// Project names follow the same rule as board names: trimmed, 1 to 50 Unicode
/// scalar values, one line.
pub fn validate_project_name(value: &str) -> Result<String, AgboardError> {
    one_line(value, NAME_MAX).ok_or_else(|| {
        invalid(
            "name",
            "Project names must be 1 to 50 characters on one line.",
        )
    })
}

pub fn validate_title(value: &str) -> Result<String, AgboardError> {
    one_line(value, TITLE_MAX)
        .ok_or_else(|| invalid("title", "Titles must be 1 to 100 characters on one line."))
}

/// Convert CRLF to LF, then require at most 50,000 Unicode scalar values.
/// Surrounding whitespace is kept.
pub fn normalize_and_validate_description(value: &str) -> Result<String, AgboardError> {
    let normalized = value.replace("\r\n", "\n");
    let count = normalized.chars().count();
    if count > DESCRIPTION_MAX {
        return Err(invalid(
            "description",
            format!("Descriptions must be 50,000 characters or fewer. This one has {count}."),
        ));
    }
    Ok(normalized)
}

pub fn validate_reason(value: &str) -> Result<String, AgboardError> {
    one_line(value, REASON_MAX)
        .ok_or_else(|| invalid("reason", "Reasons must be 1 to 100 characters on one line."))
}
