use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Value, json};
use skan::domain::{BoardMeta, BoardSnapshot, Card, Column, RunState, Transition};
use skan::error::{FileAction, SkanError};
use skan::store::Store;
use skan::transfer::{
    ExportFile, read_and_validate, resolve_output, serialize, to_export_file, validate,
    write_atomic,
};
use std::fs;
use std::path::{Path, PathBuf};

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

// ------------------------------------------------------------------- import

/// One card in the file's JSON form. Each transition is `(from, to, at)`.
fn card_json(
    id: i64,
    column: &str,
    position: i64,
    run_state: &str,
    reason: Option<&str>,
    transitions: &[(Option<&str>, &str, &str)],
) -> Value {
    let history: Vec<Value> = transitions
        .iter()
        .map(|(from, to, at)| json!({ "from": from, "to": to, "at": at }))
        .collect();
    json!({
        "id": id,
        "title": format!("Card {id}"),
        "description": "",
        "column": column,
        "position": position,
        "run_state": run_state,
        "pending_reason": reason,
        "created_at": "2026-10-02T00:00:00Z",
        "updated_at": "2026-10-02T03:00:00Z",
        "run_state_changed_at": "2026-10-02T03:00:00Z",
        "transitions": history,
    })
}

/// A valid file with one card per situation: #1 idle in Todo, #2 running and
/// #3 pending in Doing, #4 idle in Done. `next_card_id` leaves a gap (#5).
fn valid_json() -> Value {
    let created = (None, "todo", "2026-10-02T00:00:00Z");
    let started = (Some("todo"), "doing", "2026-10-02T01:00:00Z");
    let finished = (Some("doing"), "done", "2026-10-02T02:00:00Z");
    json!({
        "format": "skan-board",
        "version": 1,
        "board": {
            "name": "simplekanban",
            "next_card_id": 6,
            "created_at": "2026-10-01T07:00:00Z"
        },
        "cards": [
            card_json(1, "todo", 1, "idle", None, &[created]),
            card_json(2, "doing", 1, "running", None, &[created, started]),
            card_json(3, "doing", 2, "pending", Some("Waiting for review"), &[created, started]),
            card_json(4, "done", 1, "idle", None, &[created, started, finished]),
        ]
    })
}

fn write_json(dir: &Path, value: &Value) -> PathBuf {
    let path = dir.join("board.json");
    fs::write(&path, serde_json::to_string_pretty(value).unwrap()).unwrap();
    path
}

/// The `skan import` flow without the CLI: validate, then replace the board.
fn import(store: &Store, path: &Path) -> Result<(), SkanError> {
    let snapshot = read_and_validate(path)?;
    store.replace_all(&snapshot)
}

/// A store holding the board from `valid_json()` under a different name, so a
/// wrongly accepted import would be visible.
fn existing_store(dir: &Path) -> Store {
    let store = Store::open(&dir.join("board.db")).unwrap();
    store.create_board("existing", t(0, 0)).unwrap();
    store.add_card("keep me", "", t(0, 1)).unwrap();
    store
}

/// Apply `mutate` to a valid file and expect `ImportInvalid` with `reason`,
/// leaving the existing board untouched.
fn assert_rejected(mutate: impl FnOnce(&mut Value), reason: &str) {
    let dir = tempfile::tempdir().unwrap();
    let store = existing_store(dir.path());
    let before = store.snapshot().unwrap();

    let mut value = valid_json();
    mutate(&mut value);
    let path = write_json(dir.path(), &value);

    let error = import(&store, &path).unwrap_err();
    assert_eq!(
        error,
        SkanError::ImportInvalid {
            file: path.display().to_string(),
            reason: reason.to_string(),
        }
    );
    assert_eq!(
        error.message(),
        format!("{} is not a valid board file.", path.display())
    );
    assert_eq!(
        store.snapshot().unwrap(),
        before,
        "the board must not change"
    );
}

#[test]
fn a_valid_file_is_accepted_and_replaces_the_board() {
    let dir = tempfile::tempdir().unwrap();
    let store = existing_store(dir.path());
    let path = write_json(dir.path(), &valid_json());

    import(&store, &path).unwrap();

    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.board.name, "simplekanban");
    assert_eq!(snapshot.board.next_card_id, 6);
    let ids: Vec<i64> = snapshot.cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![1, 2, 3, 4]);
    // Running and pending are kept as they are, not reset.
    assert_eq!(snapshot.cards[1].run_state, skan::domain::RunState::Running);
    assert_eq!(
        snapshot.cards[2].pending_reason.as_deref(),
        Some("Waiting for review")
    );
}

#[test]
fn a_valid_file_with_cards_out_of_id_order_gives_a_sorted_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let mut value = valid_json();
    value["cards"].as_array_mut().unwrap().reverse();
    let path = write_json(dir.path(), &value);
    let snapshot = read_and_validate(&path).unwrap();
    let ids: Vec<i64> = snapshot.cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![1, 2, 3, 4]);
}

#[test]
fn an_empty_board_file_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let mut value = valid_json();
    value["cards"] = json!([]);
    value["board"]["next_card_id"] = json!(1);
    let path = write_json(dir.path(), &value);
    let snapshot = read_and_validate(&path).unwrap();
    assert!(snapshot.cards.is_empty());
    assert_eq!(snapshot.board.next_card_id, 1);
}

#[test]
fn a_missing_file_is_a_read_file_error_and_the_board_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let store = existing_store(dir.path());
    let before = store.snapshot().unwrap();
    let path = dir.path().join("nope.json");
    let error = import(&store, &path).unwrap_err();
    match &error {
        SkanError::FileError {
            action,
            file,
            reason,
        } => {
            assert_eq!(*action, FileAction::Read);
            assert_eq!(file, &path.display().to_string());
            assert!(!reason.is_empty());
        }
        other => panic!("expected FileError, got {other:?}"),
    }
    assert_eq!(error.message(), format!("cannot read {}.", path.display()));
    assert_eq!(store.snapshot().unwrap(), before);
}

#[test]
fn a_directory_is_a_read_file_error() {
    let dir = tempfile::tempdir().unwrap();
    let result = read_and_validate(dir.path());
    assert!(matches!(
        result,
        Err(SkanError::FileError {
            action: FileAction::Read,
            ..
        })
    ));
}

/// Write raw bytes and expect `ImportInvalid`; return its reason.
fn rejected_reason_for_bytes(bytes: &[u8]) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.json");
    fs::write(&path, bytes).unwrap();
    match read_and_validate(&path) {
        Err(SkanError::ImportInvalid { file, reason }) => {
            assert_eq!(file, path.display().to_string());
            reason
        }
        other => panic!("expected ImportInvalid, got {other:?}"),
    }
}

#[test]
fn files_that_are_not_json_are_import_invalid_with_a_position() {
    let reason = rejected_reason_for_bytes(b"this is not json");
    assert!(reason.contains("line 1 column"), "{reason}");
    let reason = rejected_reason_for_bytes(b"");
    assert!(reason.contains("line 1 column 0"), "{reason}");
    let reason = rejected_reason_for_bytes(b"{\n  \"format\": \"skan-board\",\n  oops\n}");
    assert!(reason.contains("line 3"), "{reason}");
    let reason = rejected_reason_for_bytes(&[0xff, 0xfe, 0x00]);
    assert!(reason.contains("line 1"), "{reason}");
}

#[test]
fn json_with_missing_wrong_typed_or_unknown_items_is_import_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let cases: Vec<Box<dyn Fn(&mut Value)>> = vec![
        Box::new(|v| {
            v.as_object_mut().unwrap().remove("cards");
        }),
        Box::new(|v| v["cards"][0]["column"] = json!("review")),
        Box::new(|v| v["cards"][0]["run_state"] = json!("sleeping")),
        Box::new(|v| v["cards"][0]["id"] = json!("one")),
        Box::new(|v| v["cards"][0]["position"] = json!(1.5)),
        Box::new(|v| v["cards"][0]["created_at"] = json!(20261002)),
        Box::new(|v| v["cards"][0]["transitions"][0]["to"] = json!(null)),
        Box::new(|v| v["cards"][0]["extra"] = json!(true)),
        Box::new(|v| v["board"]["name"] = json!(["a"])),
        Box::new(|v| v["cards"] = json!({})),
    ];
    for (index, mutate) in cases.iter().enumerate() {
        let mut value = valid_json();
        mutate(&mut value);
        let path = write_json(dir.path(), &value);
        match read_and_validate(&path) {
            Err(SkanError::ImportInvalid { reason, .. }) => {
                assert!(reason.contains("line"), "case {index}: {reason}");
            }
            other => panic!("case {index}: expected ImportInvalid, got {other:?}"),
        }
    }
}

const FORMAT_REASON: &str = "The format must be \"skan-board\" with version 1.";

#[test]
fn the_format_and_version_must_match() {
    assert_rejected(|v| v["format"] = json!("other-board"), FORMAT_REASON);
    assert_rejected(|v| v["format"] = json!("Skan-Board"), FORMAT_REASON);
    assert_rejected(|v| v["version"] = json!(2), FORMAT_REASON);
    assert_rejected(|v| v["version"] = json!(0), FORMAT_REASON);
    assert_rejected(|v| v["version"] = json!("1"), FORMAT_REASON);
    assert_rejected(|v| v["version"] = json!(1.0), FORMAT_REASON);
    assert_rejected(
        |v| {
            v.as_object_mut().unwrap().remove("format");
        },
        FORMAT_REASON,
    );
    assert_rejected(
        |v| {
            v.as_object_mut().unwrap().remove("version");
        },
        FORMAT_REASON,
    );
}

#[test]
fn a_file_of_another_shape_reports_the_format_not_a_parse_error() {
    assert_rejected(|v| *v = json!({ "something": "else" }), FORMAT_REASON);
    assert_rejected(|v| *v = json!([1, 2, 3]), FORMAT_REASON);
    assert_rejected(|v| *v = json!("skan-board"), FORMAT_REASON);
}

#[test]
fn the_format_is_checked_before_everything_else() {
    assert_rejected(
        |v| {
            v["version"] = json!(2);
            v["board"]["name"] = json!("");
            v["cards"][0]["id"] = json!(2);
        },
        FORMAT_REASON,
    );
}

#[test]
fn validate_rejects_a_typed_file_with_the_wrong_format() {
    let mut file = to_export_file(&sample_snapshot());
    file.version = 2;
    assert_eq!(
        validate(&file),
        Err(SkanError::ImportInvalid {
            file: "skan.json".into(),
            reason: FORMAT_REASON.into()
        })
    );
}
