//! Parsing one shared JSON file, and turning tolerated errors into problems.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::AgboardError;
use crate::file_store::model::{Problem, TaskMetadata};
use crate::file_store::validate;

/// Parse one shared JSON file. Syntax errors, the `formatVersion` gate, and
/// the strict shape (unknown or missing fields) are all reported here.
pub(crate) fn parse_file<T: DeserializeOwned>(
    bytes: &[u8],
    label: &str,
) -> Result<T, AgboardError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| AgboardError::FileInvalid {
        file: label.to_string(),
        field: String::new(),
        reason: format!("The JSON is malformed: {e}."),
    })?;
    validate::check_format_version(&value, label)?;
    serde_json::from_value(value).map_err(|e| {
        let message = e.to_string();
        AgboardError::FileInvalid {
            file: label.to_string(),
            field: message.split('`').nth(1).unwrap_or("").to_string(),
            reason: message,
        }
    })
}

pub(super) fn parse_task_metadata(bytes: &[u8], label: &str) -> Result<TaskMetadata, AgboardError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| AgboardError::FileInvalid {
        file: label.to_string(),
        field: String::new(),
        reason: format!("The JSON is malformed: {e}."),
    })?;
    validate::check_format_version(&value, label)?;
    serde_json::from_value(value).map_err(|e| {
        let message = e.to_string();
        AgboardError::FileInvalid {
            file: label.to_string(),
            field: message.split('`').nth(1).unwrap_or("").to_string(),
            reason: message,
        }
    })
}

/// The problem a tolerated read error stands for, with the file label kept.
pub(crate) fn problem_of(error: AgboardError) -> Problem {
    match error {
        AgboardError::FileInvalid {
            file,
            field,
            reason,
        } => Problem {
            file,
            field,
            reason,
        },
        AgboardError::FormatUnsupported {
            file,
            version,
            expected,
        } => Problem {
            file,
            field: "formatVersion".into(),
            reason: format!("Only formatVersion {expected} is supported, found {version}."),
        },
        AgboardError::FileUnreadable { file, reason } => Problem {
            file,
            field: String::new(),
            reason,
        },
        other => Problem {
            file: String::new(),
            field: String::new(),
            reason: other.reason(),
        },
    }
}

pub(super) fn file_time(path: &Path) -> Option<DateTime<Utc>> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    DateTime::from_timestamp(DateTime::<Utc>::from(modified).timestamp(), 0)
}
