//! Checks and normalization of a decision request's choices.

use std::collections::HashSet;

use super::{Defect, defect};
use crate::domain::{MAX_CHOICE_ID_CHARS, MAX_CHOICE_LABEL_CHARS, MAX_CHOICES, MIN_CHOICES};
use crate::error::AgboardError;
use crate::file_store::model::Choice;

/// The first defect of a decision request's choices, if any. Field names are
/// relative: `choices`, `choices.id`, or `choices.label`.
pub fn choice_defect(choices: &[Choice]) -> Option<Defect> {
    if !(MIN_CHOICES..=MAX_CHOICES).contains(&choices.len()) {
        return Some(defect("choices", "A request must have 2 to 10 choices."));
    }
    choice_items_defect(choices)
}

/// Validate choice contents independently of request cardinality, including a
/// single selection retained in a resolved answer.
pub(super) fn choice_items_defect(choices: &[Choice]) -> Option<Defect> {
    let mut ids = HashSet::new();
    for choice in choices {
        let id_ok = (1..=MAX_CHOICE_ID_CHARS).contains(&choice.id.len())
            && choice
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !id_ok {
            return Some(defect(
                "choices.id",
                "Choice IDs are 1 to 64 ASCII letters, digits, hyphens, or underscores.",
            ));
        }
        if !ids.insert(choice.id.as_str()) {
            return Some(defect(
                "choices.id",
                "Choice IDs must be unique within a request.",
            ));
        }
        let label_chars = choice.label.trim().chars().count();
        if !(1..=MAX_CHOICE_LABEL_CHARS).contains(&label_chars) {
            return Some(defect(
                "choices.label",
                "Choice labels must be 1 to 200 characters.",
            ));
        }
    }
    None
}

/// Trim the labels of `choices` and check them. A violation is `InvalidValue`.
pub fn normalize_choices(choices: Vec<Choice>) -> Result<Vec<Choice>, AgboardError> {
    let normalized: Vec<Choice> = choices
        .into_iter()
        .map(|c| Choice {
            id: c.id,
            label: c.label.trim().to_string(),
        })
        .collect();
    match choice_defect(&normalized) {
        None => Ok(normalized),
        Some(d) => Err(AgboardError::InvalidValue {
            field: d.field,
            reason: d.reason,
        }),
    }
}
