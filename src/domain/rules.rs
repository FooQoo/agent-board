use crate::error::SkanError;

use super::{Card, Column, RunState};

/// Why a run-state report was refused. Carries no card id because the domain
/// rule works on a column and a state only; convert with [`RunStateViolation::into_error`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunStateViolation {
    /// `running` or `pending` was requested outside `doing`.
    InvalidStateForColumn,
    /// A reason was given for a state other than `pending`.
    ReasonRequiresPending,
}

impl RunStateViolation {
    pub fn into_error(self, id: i64, column: Column, state: RunState) -> SkanError {
        match self {
            RunStateViolation::InvalidStateForColumn => {
                SkanError::InvalidStateForColumn { id, state, column }
            }
            RunStateViolation::ReasonRequiresPending => SkanError::ReasonRequiresPending,
        }
    }
}

/// Check a run-state report against the rules: `running` and `pending` only in
/// `doing`, a reason only with `pending`. The reason rule is checked first
/// because it depends on the arguments alone, not on the card.
pub fn check_run_state(
    column: Column,
    state: RunState,
    reason: Option<&str>,
) -> Result<(), RunStateViolation> {
    if reason.is_some() && state != RunState::Pending {
        return Err(RunStateViolation::ReasonRequiresPending);
    }
    if state != RunState::Idle && column != Column::Doing {
        return Err(RunStateViolation::InvalidStateForColumn);
    }
    Ok(())
}

fn column_rank(column: Column) -> u8 {
    match column {
        Column::Todo => 0,
        Column::Doing => 1,
        Column::Done => 2,
    }
}

/// Sort in display order: column order, `todo` and `doing` by ascending
/// `position`, `done` by descending `position`.
pub fn sort_cards(cards: &mut [Card]) {
    cards.sort_by_key(|c| {
        let position = if c.column == Column::Done {
            -c.position
        } else {
            c.position
        };
        (column_rank(c.column), position)
    });
}
