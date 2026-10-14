//! Pure domain types and rules. No I/O.

mod card;
mod column;
mod limits;
mod project;
mod work;

pub use card::BoardMeta;
pub use column::{Column, RunState};
pub use limits::{
    MAX_ANSWER_TEXT_CHARS, MAX_ATTACHMENT_BYTES, MAX_CARD_ATTACHMENT_BYTES, MAX_CARD_ATTACHMENTS,
    MAX_CHOICE_ID_CHARS, MAX_CHOICE_LABEL_CHARS, MAX_CHOICES, MAX_QUESTION_CHARS,
    normalize_and_validate_description, validate_attachment, validate_board_name,
    validate_project_name, validate_reason, validate_title,
};
pub use project::{ChangeCursor, ProjectCatalog, ProjectId, ProjectMeta};
pub use work::{
    Actor, Assignee, Attachment, AttachmentData, AttachmentInput, BulkArchiveResult, Card,
    ChangeContext, Changed, HistoryEvent, NewCard, ValidatedAttachment, ValidatedBoard,
};

const WORK_REASON_MAX: usize = 10_000;

/// Normalize line endings, trim the outer boundary, and validate a work-history reason.
pub fn validate_work_reason(value: &str) -> Result<String, crate::error::AgboardError> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    let count = value.chars().count();
    if trimmed.is_empty() || count > WORK_REASON_MAX {
        return Err(crate::error::AgboardError::InvalidValue {
            field: "reason".into(),
            reason: "Reasons must be 1 to 10000 characters.".into(),
        });
    }
    Ok(trimmed.to_owned())
}

/// Which run states a card may take. Idle is always allowed. An AI card may be
/// pending in Todo (a question before the work starts) or in Doing; it may run
/// only in Doing. A person's card is only idle. Nothing else may be pending.
pub fn check_work_state(
    assignee: Assignee,
    column: Column,
    state: RunState,
) -> Result<(), crate::error::AgboardError> {
    let allowed = state == RunState::Idle
        || matches!(
            (assignee, column, state),
            (Assignee::Ai, Column::Todo, RunState::Pending)
                | (
                    Assignee::Ai,
                    Column::Doing,
                    RunState::Pending | RunState::Running
                )
        );
    if allowed {
        Ok(())
    } else {
        Err(crate::error::AgboardError::InvalidStateForAssignee)
    }
}
