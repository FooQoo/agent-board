use chrono::{DateTime, TimeZone, Utc};
use skan::domain::{BoardMeta, BoardSnapshot, Card, Column, RunState, Transition};
use skan::error::{FileAction, SkanError};
use skan::transfer::{ExportFile, resolve_output, serialize, to_export_file, write_atomic};
use std::fs;
use std::path::Path;

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

// ------------------------------------------------------------- resolve_output

#[test]
fn no_argument_means_skan_json_in_the_working_directory() {
    let cwd = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_output(None, cwd.path()),
        cwd.path().join("skan.json")
    );
}

#[test]
fn an_existing_directory_means_skan_json_inside_it() {
    let cwd = tempfile::tempdir().unwrap();
    fs::create_dir(cwd.path().join("backups")).unwrap();
    // Relative to cwd.
    assert_eq!(
        resolve_output(Some(Path::new("backups")), cwd.path()),
        cwd.path().join("backups").join("skan.json")
    );
    // Absolute.
    let abs = cwd.path().join("backups");
    assert_eq!(
        resolve_output(Some(&abs), cwd.path()),
        abs.join("skan.json")
    );
    // The working directory itself ("." components are dropped).
    assert_eq!(
        resolve_output(Some(Path::new(".")), cwd.path()),
        cwd.path().join("skan.json")
    );
}

#[test]
fn a_file_path_is_used_as_given_whether_or_not_it_exists() {
    let cwd = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_output(Some(Path::new("mine.json")), cwd.path()),
        cwd.path().join("mine.json")
    );
    fs::write(cwd.path().join("old.json"), "x").unwrap();
    assert_eq!(
        resolve_output(Some(Path::new("old.json")), cwd.path()),
        cwd.path().join("old.json")
    );
    let abs = cwd.path().join("elsewhere.json");
    assert_eq!(resolve_output(Some(&abs), Path::new("/nonexistent")), abs);
}

// --------------------------------------------------------------- write_atomic

fn dir_entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn write_atomic_creates_the_file_and_leaves_no_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skan.json");
    write_atomic(&path, "hello\n").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "hello\n");
    assert_eq!(dir_entries(dir.path()), vec!["skan.json"]);
}

#[test]
fn write_atomic_replaces_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skan.json");
    fs::write(&path, "old contents that are longer").unwrap();
    write_atomic(&path, "new").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    assert_eq!(dir_entries(dir.path()), vec!["skan.json"]);
}

#[test]
fn write_atomic_into_a_missing_directory_is_a_file_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing").join("skan.json");
    let err = write_atomic(&path, "x").unwrap_err();
    match err {
        SkanError::FileError {
            action,
            file,
            reason,
        } => {
            assert_eq!(action, FileAction::Write);
            assert_eq!(file, path.display().to_string());
            assert!(!reason.is_empty());
        }
        other => panic!("expected FileError, got {other:?}"),
    }
}

#[test]
fn write_atomic_onto_a_directory_fails_and_cleans_up_its_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("skan.json");
    fs::create_dir(&target).unwrap();
    let err = write_atomic(&target, "x").unwrap_err();
    assert!(matches!(
        err,
        SkanError::FileError {
            action: FileAction::Write,
            ..
        }
    ));
    assert_eq!(dir_entries(dir.path()), vec!["skan.json"]);
    assert!(target.is_dir());
}

#[cfg(unix)]
#[test]
fn a_read_only_directory_is_a_file_error_and_keeps_the_existing_file() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("skan.json");
    fs::write(&path, "original").unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();

    // Root ignores directory permissions; skip the assertion in that case.
    let can_write_anyway = fs::write(dir.path().join("probe"), "").is_ok();
    let result = write_atomic(&path, "replacement");
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
    if can_write_anyway {
        return;
    }

    assert!(matches!(
        result,
        Err(SkanError::FileError {
            action: FileAction::Write,
            ..
        })
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    assert_eq!(dir_entries(dir.path()), vec!["skan.json"]);
}
