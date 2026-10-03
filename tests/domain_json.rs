use chrono::{TimeZone, Utc};
use skan::domain::{BoardMeta, BoardSnapshot, Card, Column, RunState, Transition};

fn at(h: u32, m: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, h, m, 0).unwrap()
}

fn model_example() -> Card {
    Card {
        id: 12,
        title: "Restore a board from JSON".into(),
        description: String::new(),
        column: Column::Doing,
        position: 2,
        run_state: RunState::Pending,
        pending_reason: Some("Waiting for confirmation on how to replace a board".into()),
        created_at: at(0, 20),
        updated_at: at(1, 36),
        run_state_changed_at: at(1, 36),
        transitions: vec![
            Transition {
                from: None,
                to: Column::Todo,
                at: at(0, 20),
            },
            Transition {
                from: Some(Column::Todo),
                to: Column::Doing,
                at: at(1, 10),
            },
        ],
    }
}

const MODEL_JSON: &str = concat!(
    r#"{"id":12,"title":"Restore a board from JSON","description":"","column":"doing","#,
    r#""position":2,"run_state":"pending","#,
    r#""pending_reason":"Waiting for confirmation on how to replace a board","#,
    r#""created_at":"2026-10-02T00:20:00Z","updated_at":"2026-10-02T01:36:00Z","#,
    r#""run_state_changed_at":"2026-10-02T01:36:00Z","#,
    r#""transitions":[{"from":null,"to":"todo","at":"2026-10-02T00:20:00Z"},"#,
    r#"{"from":"todo","to":"doing","at":"2026-10-02T01:10:00Z"}]}"#
);

#[test]
fn card_serializes_with_model_key_order_and_value_shapes() {
    assert_eq!(serde_json::to_string(&model_example()).unwrap(), MODEL_JSON);
}

#[test]
fn card_without_reason_serializes_null() {
    let mut card = model_example();
    card.run_state = RunState::Idle;
    card.pending_reason = None;
    let json = serde_json::to_string(&card).unwrap();
    assert!(
        json.contains(r#""run_state":"idle","pending_reason":null,"created_at""#),
        "{json}"
    );
}

#[test]
fn card_round_trips() {
    let card: Card = serde_json::from_str(MODEL_JSON).unwrap();
    assert_eq!(card, model_example());
}

#[test]
fn datetime_without_z_is_rejected() {
    let bad = MODEL_JSON.replace(
        "2026-10-02T00:20:00Z\",\"updated",
        "2026-10-02T00:20:00+00:00\",\"updated",
    );
    assert_ne!(bad, MODEL_JSON);
    assert!(serde_json::from_str::<Card>(&bad).is_err());
}

#[test]
fn snapshot_serializes_board_then_cards() {
    let snapshot = BoardSnapshot {
        board: BoardMeta {
            name: "simplekanban".into(),
            next_card_id: 17,
            created_at: at(0, 0),
        },
        cards: vec![model_example()],
    };
    let json = serde_json::to_string(&snapshot).unwrap();
    assert_eq!(
        json,
        format!(
            r#"{{"board":{{"name":"simplekanban","next_card_id":17,"created_at":"2026-10-02T00:00:00Z"}},"cards":[{MODEL_JSON}]}}"#
        )
    );
    let back: BoardSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(back, snapshot);
}
