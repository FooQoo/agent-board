use agent_board::domain::{Assignee, Column, RunState, check_work_state, validate_work_reason};

#[test]
fn run_states_follow_the_table_for_each_owner_and_column() {
    // An AI card may ask (pending) in todo; it runs and waits in doing. A person's card is only idle.
    let allowed = |assignee: Assignee, column: Column, state: RunState| {
        state == RunState::Idle
            || matches!(
                (assignee, column, state),
                (Assignee::Ai, Column::Todo, RunState::Pending)
                    | (
                        Assignee::Ai,
                        Column::Doing,
                        RunState::Pending | RunState::Running
                    )
            )
    };
    for assignee in [Assignee::Ai, Assignee::Human] {
        for column in [Column::Todo, Column::Doing, Column::Done] {
            for state in [RunState::Idle, RunState::Running, RunState::Pending] {
                assert_eq!(
                    check_work_state(assignee, column, state).is_ok(),
                    allowed(assignee, column, state),
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
