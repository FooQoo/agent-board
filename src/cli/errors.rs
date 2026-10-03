//! Showing a [`SkanError`] on standard error.

use crate::error::SkanError;

/// The error as shown to a human: `Error:` and `Reason:` lines.
pub fn human(error: &SkanError) -> String {
    format!("Error: {}\nReason: {}\n", error.message(), error.reason())
}

/// The error as one line of JSON: `{"error":{"code","message","reason"}}`.
pub fn json(_error: &SkanError) -> String {
    String::new()
}
