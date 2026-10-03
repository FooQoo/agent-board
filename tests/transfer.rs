use chrono::{DateTime, TimeZone, Utc};
use skan::domain::{BoardMeta, BoardSnapshot, Card, Column, RunState, Transition};
use skan::transfer::{ExportFile, serialize, to_export_file};

fn t(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, hour, minute, 0).unwrap()
}

fn tr(from: Option<Column>, to: Column, at: DateTime<Utc>) -> Transition {
    Transition { from, to, at }
}

/// A small board with a pending card in Doing and an idle card in Todo.
/// Cards are deliberately out of ID order.
fn sample_snapshot() -> BoardSnapshot {
    let pending = Card {
        id: 12,
        title: "Restore a board from JSON".into(),
        description: String::new(),
        column: Column::Doing,
        position: 2,
        run_state: RunState::Pending,
        pending_reason: Some("Waiting for confirmation".into()),
        created_at: t(0, 20),
        updated_at: t(1, 36),
        run_state_changed_at: t(1, 36),
        transitions: vec![
            tr(None, Column::Todo, t(0, 20)),
            tr(Some(Column::Todo), Column::Doing, t(1, 10)),
        ],
    };
    let idle = Card {
        id: 3,
        title: "ボードを復元する".into(),
        description: "line one\nline two".into(),
        column: Column::Todo,
        position: 1,
        run_state: RunState::Idle,
        pending_reason: None,
        created_at: t(0, 5),
        updated_at: t(0, 5),
        run_state_changed_at: t(0, 5),
        transitions: vec![tr(None, Column::Todo, t(0, 5))],
    };
    BoardSnapshot {
        board: BoardMeta {
            name: "simplekanban".into(),
            next_card_id: 17,
            created_at: Utc.with_ymd_and_hms(2026, 10, 1, 7, 0, 0).unwrap(),
        },
        cards: vec![pending, idle],
    }
}

const SAMPLE_JSON: &str = r#"{
  "format": "skan-board",
  "version": 1,
  "board": {
    "name": "simplekanban",
    "next_card_id": 17,
    "created_at": "2026-10-01T07:00:00Z"
  },
  "cards": [
    {
      "id": 3,
      "title": "ボードを復元する",
      "description": "line one\nline two",
      "column": "todo",
      "position": 1,
      "run_state": "idle",
      "pending_reason": null,
      "created_at": "2026-10-02T00:05:00Z",
      "updated_at": "2026-10-02T00:05:00Z",
      "run_state_changed_at": "2026-10-02T00:05:00Z",
      "transitions": [
        {
          "from": null,
          "to": "todo",
          "at": "2026-10-02T00:05:00Z"
        }
      ]
    },
    {
      "id": 12,
      "title": "Restore a board from JSON",
      "description": "",
      "column": "doing",
      "position": 2,
      "run_state": "pending",
      "pending_reason": "Waiting for confirmation",
      "created_at": "2026-10-02T00:20:00Z",
      "updated_at": "2026-10-02T01:36:00Z",
      "run_state_changed_at": "2026-10-02T01:36:00Z",
      "transitions": [
        {
          "from": null,
          "to": "todo",
          "at": "2026-10-02T00:20:00Z"
        },
        {
          "from": "todo",
          "to": "doing",
          "at": "2026-10-02T01:10:00Z"
        }
      ]
    }
  ]
}
"#;

// ------------------------------------------------------- export file / serialize

#[test]
fn export_file_has_the_format_marker_and_sorts_cards_by_id() {
    let file = to_export_file(&sample_snapshot());
    assert_eq!(file.format, "skan-board");
    assert_eq!(file.version, 1);
    assert_eq!(file.board, sample_snapshot().board);
    let ids: Vec<i64> = file.cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![3, 12]);
}

#[test]
fn serialize_matches_the_expected_text_exactly() {
    let text = serialize(&to_export_file(&sample_snapshot()));
    assert_eq!(text, SAMPLE_JSON);
}

#[test]
fn serialize_ends_with_exactly_one_newline_and_uses_two_space_indent() {
    let text = serialize(&to_export_file(&sample_snapshot()));
    assert!(text.ends_with("}\n") && !text.ends_with("\n\n"));
    assert!(text.contains("\n  \"format\""));
    assert!(!text.contains('\t'));
    assert!(!text.contains('\r'));
}

#[test]
fn serialize_is_deterministic() {
    let file = to_export_file(&sample_snapshot());
    assert_eq!(serialize(&file), serialize(&file));
    // Rebuilding from the same snapshot, even with the cards reordered, gives
    // the same bytes.
    let mut reversed = sample_snapshot();
    reversed.cards.reverse();
    assert_eq!(serialize(&to_export_file(&reversed)), SAMPLE_JSON);
}

#[test]
fn an_empty_board_serializes_with_an_empty_card_list() {
    let mut snapshot = sample_snapshot();
    snapshot.cards.clear();
    snapshot.board.next_card_id = 1;
    let text = serialize(&to_export_file(&snapshot));
    assert!(text.contains("\"cards\": []\n}\n"), "{text}");
}

#[test]
fn export_file_json_round_trips_through_serde() {
    let file = to_export_file(&sample_snapshot());
    let back: ExportFile = serde_json::from_str(&serialize(&file)).unwrap();
    assert_eq!(back, file);
}
