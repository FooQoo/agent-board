//! Pure domain types and rules. No I/O.

mod card;
mod column;
mod limits;
mod project;
mod work;

pub use card::BoardMeta;
pub use column::{Column, RunState};
pub use limits::{
    normalize_and_validate_description, validate_board_name, validate_project_name,
    validate_reason, validate_title,
};
pub use project::{ChangeCursor, ProjectCatalog, ProjectId, ProjectMeta};
pub use work::{
    Actor, Assignee, BoardSnapshot, Card, ChangeContext, Changed, FetchedSnapshot, HistoryEvent,
    HistoryKind, NewCard, ValidatedBoard,
};

const WORK_REASON_MAX: usize = 2_000;

/// Normalize line endings, trim the outer boundary, and validate a work-history reason.
pub fn validate_work_reason(value: &str) -> Result<String, crate::error::SkanError> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > WORK_REASON_MAX {
        return Err(crate::error::SkanError::InvalidValue {
            field: "reason".into(),
            reason: "Reasons must be 1 to 2000 characters.".into(),
        });
    }
    Ok(trimmed.to_owned())
}

pub fn check_work_state(
    assignee: Assignee,
    column: Column,
    state: RunState,
) -> Result<(), crate::error::SkanError> {
    if state != RunState::Idle && (assignee != Assignee::Ai || column != Column::Doing) {
        return Err(crate::error::SkanError::InvalidStateForAssignee);
    }
    Ok(())
}
