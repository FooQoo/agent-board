use crate::error::SkanError;

use super::{Card, Column, RunState};

pub fn check_run_state(
    _column: Column,
    _state: RunState,
    _reason: Option<&str>,
) -> Result<(), SkanError> {
    todo!()
}

pub fn sort_cards(_cards: &mut [Card]) {
    todo!()
}
