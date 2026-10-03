//! Pure domain types and rules. No I/O.

mod card;
mod column;
mod limits;
mod rules;

pub use card::{BoardMeta, BoardSnapshot, Card, Transition};
pub use column::{Column, RunState};
pub use limits::{
    normalize_and_validate_description, validate_board_name, validate_reason, validate_title,
};
pub use rules::{RunStateViolation, check_run_state, sort_cards};
