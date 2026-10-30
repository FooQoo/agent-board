//! Epic identifiers, colors, names and documents, and the `epic.json` check.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::{Defect, defect, is_hex32};
use crate::error::AgboardError;
use crate::file_store::model::EpicFile;

/// An EPIC-ID in canonical form: `[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*`, 1 to 64
/// characters. `FromStr` accepts only the canonical form; `normalize` folds
/// lowercase letters to uppercase first, as the CLI does.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EpicId(String);

impl EpicId {
    /// Fold ASCII lowercase letters to uppercase, then check the grammar.
    pub fn normalize(text: &str) -> Result<EpicId, AgboardError> {
        text.to_ascii_uppercase().parse()
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn is_epic_id(text: &str) -> bool {
    if text.is_empty() || text.len() > 64 {
        return false;
    }
    let upper_or_digit = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    };
    let mut parts = text.split('-');
    let first = parts.next().unwrap_or("");
    first
        .as_bytes()
        .first()
        .is_some_and(|b| b.is_ascii_uppercase())
        && upper_or_digit(first)
        && parts.all(upper_or_digit)
}

impl FromStr for EpicId {
    type Err = AgboardError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if is_epic_id(s) {
            Ok(EpicId(s.to_string()))
        } else {
            Err(AgboardError::InvalidValue {
                field: "epicId".into(),
                reason: "EPIC-IDs are 1 to 64 uppercase letters, digits, and hyphens, starting with a letter."
                    .into(),
            })
        }
    }
}

impl fmt::Display for EpicId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for EpicId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for EpicId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: AgboardError| serde::de::Error::custom(e.reason()))
    }
}

/// `#RRGGBB` with uppercase digits, the stored form of an epic color.
/// Surrounding whitespace is ignored and lowercase digits are folded.
pub fn normalize_color(text: &str) -> Result<String, AgboardError> {
    let trimmed = text.trim();
    match trimmed.strip_prefix('#') {
        Some(hex) if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Ok(format!("#{}", hex.to_ascii_uppercase()))
        }
        _ => Err(AgboardError::InvalidValue {
            field: "color".into(),
            reason: "Colors are #RRGGBB: a # and six hexadecimal digits.".into(),
        }),
    }
}

fn is_stored_color(text: &str) -> bool {
    normalize_color(text).ok().as_deref() == Some(text)
}

/// An epic's formal name: trimmed, 1 to 100 characters, one line.
pub fn validate_epic_name(text: &str) -> Result<String, AgboardError> {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > 100 || trimmed.contains(['\n', '\r']) {
        return Err(AgboardError::InvalidValue {
            field: "name".into(),
            reason: "Epic names must be 1 to 100 characters on one line.".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// A document text with CRLF folded to LF, and at most 100,000 characters of
/// Markdown body. The frontmatter is not counted, because the editor counts only
/// the body.
pub fn normalize_document(text: &str) -> Result<String, AgboardError> {
    let normalized = text.replace("\r\n", "\n");
    let body = crate::file_store::frontmatter::parse_document(&normalized).body;
    let count = body.chars().count();
    if count > 100_000 {
        return Err(AgboardError::InvalidValue {
            field: "document".into(),
            reason: "Documents must be 100,000 characters or fewer.".into(),
        });
    }
    Ok(normalized)
}

/// The EPIC.md written when an epic is created without a document.
pub fn document_template() -> String {
    String::new()
}

/// Defects of `epic.json`. `folder_id` is the name of the epic folder.
pub fn check_epic(file: &EpicFile, folder_id: &str) -> Vec<Defect> {
    let mut out = Vec::new();
    if file.id.as_str() != folder_id {
        out.push(defect("id", "The ID does not match the folder name."));
    }
    if validate_epic_name(&file.name).ok().as_deref() != Some(file.name.as_str()) {
        out.push(defect(
            "name",
            "Epic names must be 1 to 100 characters on one line.",
        ));
    }
    if !is_stored_color(&file.color) {
        out.push(defect(
            "color",
            "Colors are stored as #RRGGBB in uppercase.",
        ));
    }
    for (i, attachment) in file.attachments.iter().enumerate() {
        if !is_hex32(&attachment.id) {
            out.push(defect(
                format!("attachments[{i}].id"),
                "Attachment IDs are 32 lowercase hexadecimal characters.",
            ));
        }
    }
    out
}
