use agent_board::domain::{Assignee, Column, RunState, check_work_state, validate_work_reason};

#[test]
fn only_ai_owned_doing_cards_can_run_or_wait() {
    for assignee in [Assignee::Ai, Assignee::Human] {
        for column in [Column::Todo, Column::Doing, Column::Done] {
            for state in [RunState::Idle, RunState::Running, RunState::Pending] {
                assert_eq!(
                    check_work_state(assignee, column, state).is_ok(),
                    state == RunState::Idle
                        || (assignee == Assignee::Ai && column == Column::Doing),
                    "{assignee:?} {column:?} {state:?}"
                );
            }
        }
    }
}

#[test]
fn reason_normalizes_line_endings_and_counts_unicode_scalars() {
    assert_eq!(
        validate_work_reason("  日本語😀\r\n\r\n理由\r ").unwrap(),
        "日本語😀\n\n理由"
    );
    assert!(validate_work_reason(" \r\n ").is_err());
    assert_eq!(
        validate_work_reason(&"界".repeat(2_000))
            .unwrap()
            .chars()
            .count(),
        2_000
    );
    assert!(validate_work_reason(&"界".repeat(2_001)).is_err());
}
