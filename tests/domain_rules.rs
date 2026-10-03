use chrono::{TimeZone, Utc};
use skan::domain::{Card, Column, RunState, Transition, check_run_state, sort_cards};
use skan::error::SkanError;

const COLUMNS: [Column; 3] = [Column::Todo, Column::Doing, Column::Done];
const STATES: [RunState; 3] = [RunState::Idle, RunState::Running, RunState::Pending];

#[test]
fn column_and_state_text_forms() {
    assert_eq!(Column::Todo.as_str(), "todo");
    assert_eq!(Column::Doing.as_str(), "doing");
    assert_eq!(Column::Done.as_str(), "done");
    assert_eq!(Column::Todo.label(), "Todo");
    assert_eq!(Column::Doing.label(), "Doing");
    assert_eq!(Column::Done.label(), "Done");
    assert_eq!(RunState::Idle.as_str(), "idle");
    assert_eq!(RunState::Running.as_str(), "running");
    assert_eq!(RunState::Pending.as_str(), "pending");
    assert_eq!(RunState::Idle.label(), "Idle");
    assert_eq!(RunState::Running.label(), "Running");
    assert_eq!(RunState::Pending.label(), "Pending");
}

#[test]
fn column_and_state_parse() {
    for c in COLUMNS {
        assert_eq!(c.as_str().parse::<Column>(), Ok(c));
    }
    for s in STATES {
        assert_eq!(s.as_str().parse::<RunState>(), Ok(s));
    }
    assert!("Todo".parse::<Column>().is_err());
    assert!("later".parse::<Column>().is_err());
    assert!("".parse::<RunState>().is_err());
    assert!("RUNNING".parse::<RunState>().is_err());
}

#[test]
fn check_run_state_covers_every_combination() {
    for column in COLUMNS {
        for state in STATES {
            for reason in [None, Some("waiting")] {
                let result = check_run_state(column, state, reason);
                let reason_ok = reason.is_none() || state == RunState::Pending;
                let column_ok = state == RunState::Idle || column == Column::Doing;
                let label = format!("{column:?} {state:?} {reason:?}");
                if !reason_ok {
                    let err = result.expect_err(&label).into_error(11, column, state);
                    assert_eq!(err, SkanError::ReasonRequiresPending, "{label}");
                } else if !column_ok {
                    let err = result.expect_err(&label).into_error(11, column, state);
                    assert_eq!(
                        err,
                        SkanError::InvalidStateForColumn {
                            id: 11,
                            state,
                            column
                        },
                        "{label}"
                    );
                } else {
                    assert_eq!(result, Ok(()), "{label}");
                }
            }
        }
    }
}

#[test]
fn doing_accepts_all_states_and_pending_accepts_a_reason() {
    assert!(check_run_state(Column::Doing, RunState::Running, None).is_ok());
    assert!(check_run_state(Column::Doing, RunState::Pending, None).is_ok());
    assert!(check_run_state(Column::Doing, RunState::Pending, Some("x")).is_ok());
    assert!(check_run_state(Column::Todo, RunState::Idle, None).is_ok());
    assert!(check_run_state(Column::Done, RunState::Idle, None).is_ok());
}

fn card(id: i64, column: Column, position: i64) -> Card {
    let at = Utc.with_ymd_and_hms(2026, 10, 2, 0, 0, 0).unwrap();
    Card {
        id,
        title: format!("card {id}"),
        description: String::new(),
        column,
        position,
        run_state: RunState::Idle,
        pending_reason: None,
        created_at: at,
        updated_at: at,
        run_state_changed_at: at,
        transitions: vec![Transition {
            from: None,
            to: Column::Todo,
            at,
        }],
    }
}

#[test]
fn sort_cards_orders_by_column_then_position_with_done_descending() {
    let mut cards = vec![
        card(1, Column::Done, 1),
        card(2, Column::Doing, 2),
        card(3, Column::Todo, 3),
        card(4, Column::Done, 5),
        card(5, Column::Todo, 1),
        card(6, Column::Doing, 1),
        card(7, Column::Done, 3),
        card(8, Column::Todo, 2),
    ];
    sort_cards(&mut cards);
    let ids: Vec<i64> = cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![5, 8, 3, 6, 2, 4, 7, 1]);
}
