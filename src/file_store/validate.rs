//! Checks that decide whether shared-file content is accepted.
//!
//! The JSON checks return every defect of a file. The TASK.md and EPIC.md checks
//! look only at the frontmatter's acceptance conditions, and never rewrite the text. Errors name the file and item; reasons are in English.

mod body;
mod choice;
mod epic;
mod file;

pub use self::body::*;
pub use self::choice::*;
pub use self::epic::*;
pub use self::file::*;

use crate::error::AgboardError;

/// Check that an attachment ID has the stored form (32 lowercase
/// hexadecimal characters). This is the check before a path is built from it.
pub fn check_object_id(text: &str, field: &str) -> Result<(), AgboardError> {
    if is_hex32(text) {
        Ok(())
    } else {
        Err(AgboardError::InvalidValue {
            field: field.into(),
            reason: "IDs are 32 lowercase hexadecimal characters.".into(),
        })
    }
}
/// One defect found by a check. `field` names the item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Defect {
    pub field: String,
    pub reason: String,
}

fn defect(field: impl Into<String>, reason: impl Into<String>) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

/// True for a 32-character lowercase hexadecimal string (request IDs).
pub fn is_hex32(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
