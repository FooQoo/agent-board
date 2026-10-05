use std::io::Cursor;
use std::process::{Command, Stdio};

use serde_json::Value;
use tempfile::tempdir;

#[test]
fn hook_adds_the_complete_snapshot_for_supported_events_without_mutating_data() {
    let home = tempdir().unwrap();
    let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
        .args(["init", "--name", "Agent Board"])
        .output()
        .unwrap();
    assert!(init.status.success());
    let add = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
        .args(["add", "Question", "--assignee", "ai", "--actor", "ai"])
        .output()
        .unwrap();
    assert!(add.status.success());
    let db_path = home.path().join("board.db");
    let before = std::fs::read(&db_path).unwrap();
    let input = br#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"ignored"}}"#;
    let mut cursor = Cursor::new(input);
    let result = agent_board::agent::hook::run("claude", &mut cursor, &db_path).unwrap();
    let parsed: Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        parsed["hookSpecificOutput"]["hookEventName"],
        "PostToolUseFailure"
    );
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(context.starts_with("AGBOARD_SNAPSHOT\n"));
    let snapshot: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
    assert_eq!(snapshot["cards"][0]["title"], "Question");
    assert_eq!(snapshot["cards"][0]["history"].as_array().unwrap().len(), 1);
    assert_eq!(before, std::fs::read(&db_path).unwrap());
    assert!(
        agent_board::agent::hook::run(
            "codex",
            &mut Cursor::new(br#"{"hook_event_name":"PostToolUseFailure"}"#),
            &db_path
        )
        .is_none()
    );
}

#[test]
fn hook_failure_is_bounded_and_does_not_create_a_missing_database() {
    let home = tempdir().unwrap();
    let db_path = home.path().join("missing.db");
    let input = br#"{"hook_event_name":"SessionStart"}"#;
    let output = agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path).unwrap();
    assert!(output.contains("AGBOARD_ERROR"));
    assert!(!db_path.exists());
    let oversized = vec![b'x'; 65_537];
    let output =
        agent_board::agent::hook::run("claude", &mut Cursor::new(oversized), &db_path).unwrap();
    assert!(output.contains("hook_input_too_large"));
    assert!(!db_path.exists());
}

#[test]
fn hook_never_reports_an_oversized_board_as_a_complete_snapshot() {
    use agent_board::domain::{Actor, Assignee, NewCard};
    use agent_board::store::Store;
    let home = tempdir().unwrap();
    let db_path = home.path().join("board.db");
    let store = Store::open(&db_path).unwrap();
    let now = chrono::Utc::now();
    store.create_board("Agent Board", now).unwrap();
    for index in 0..60 {
        store
            .add_work_card(
                NewCard {
                    title: format!("Card {index}"),
                    description: "あ".repeat(300),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                },
                now,
            )
            .unwrap();
    }
    let input = br#"{"hook_event_name":"PostToolUse"}"#;
    let output = agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path).unwrap();
    let parsed: Value = serde_json::from_str(&output).unwrap();
    assert!(
        parsed["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap()
            .contains("context_too_large")
    );
}

#[test]
fn installed_binary_handles_hook_json_on_stdin() {
    let home = tempdir().unwrap();
    let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
        .args(["init", "--name", "Agent Board"])
        .output()
        .unwrap();
    assert!(init.status.success());
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("SKAN_HOME", home.path())
        .args(["hook", "--agent", "codex"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"SessionStart"}"#)
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success());
    assert!(
        String::from_utf8(result.stdout)
            .unwrap()
            .contains("AGBOARD_SNAPSHOT")
    );
}
