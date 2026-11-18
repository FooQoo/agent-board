//! Acceptance conditions met out of conditions.

use serde::Serialize;

use crate::file_store::frontmatter::AcceptanceItem;

/// Conditions met out of conditions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Count {
    pub done: usize,
    pub total: usize,
}

pub(super) fn count(items: &[AcceptanceItem]) -> Count {
    Count {
        done: items.iter().filter(|item| item.done).count(),
        total: items.len(),
    }
}
