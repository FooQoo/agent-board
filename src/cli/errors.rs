//! Showing a [`AgboardError`] on standard error.

use serde_json::json;

use super::output::render_json;
use crate::error::AgboardError;

/// The error as shown to a human: `Error:` and `Reason:` lines.
pub fn human(error: &AgboardError) -> String {
    format!("Error: {}\nReason: {}\n", error.message(), error.reason())
}

/// The error as one line of JSON: `{"error":{"code","message","reason"}}`.
pub fn json(error: &AgboardError) -> String {
    let value = json!({"error": {
        "code": error.code(),
        "message": error.message(),
        "reason": error.reason(),
    }});
    format!("{}\n", render_json(&value))
}
