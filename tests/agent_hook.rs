use std::io::Cursor;
use std::process::{Command, Stdio};

use serde_json::Value;
use tempfile::tempdir;

#[test]
fn hook_adds_the_complete_snapshot_for_supported_events_without_mutating_data() {
    let home = tempdir().unwrap();
    for project in ["Agent Board", "Other"] {
        let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_HOME", home.path())
            .args(["--project", project, "init"])
            .output()
            .unwrap();
        assert!(init.status.success());
        let title = if project == "Other" {
            "Not for this hook"
        } else {
            "Question"
        };
        let add = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env("AGBOARD_HOME", home.path())
            .args([
                "--project",
                project,
                "add",
                title,
                "--assignee",
                "ai",
                "--actor",
                "ai",
            ])
            .output()
            .unwrap();
        assert!(add.status.success());
    }
    let db_path = home.path().join("shared");
    let before = tree_of(&db_path);
    let input = br#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"ignored"}}"#;
    let mut cursor = Cursor::new(input);
    let result =
        agent_board::agent::hook::run("claude", &mut cursor, &db_path, Some("Agent Board"))
            .unwrap();
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
    assert_eq!(snapshot["project"]["name"], "Agent Board");
    assert!(snapshot["cursor"].as_str().unwrap().starts_with(&format!(
        "f1:{}:",
        snapshot["project"]["id"].as_str().unwrap()
    )));
    // Only the named project's cards are passed on.
    assert_eq!(snapshot["cards"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["cards"][0]["title"], "Question");
    assert_eq!(snapshot["cards"][0]["history"].as_array().unwrap().len(), 1);
    assert_eq!(before, tree_of(&db_path));
    assert!(
        agent_board::agent::hook::run(
            "codex",
            &mut Cursor::new(br#"{"hook_event_name":"PostToolUseFailure"}"#),
            &db_path,
            Some("Agent Board")
        )
        .is_none()
    );
}

#[test]
fn hook_failure_is_bounded_and_does_not_create_a_missing_database() {
    let home = tempdir().unwrap();
    let db_path = home.path().join("missing.db");
    let input = br#"{"hook_event_name":"SessionStart"}"#;
    let output =
        agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path, Some("demo"))
            .unwrap();
    assert!(output.contains("AGBOARD_ERROR"));
    assert!(!db_path.exists());
    // A hook without a project is an error report, not a guess.
    let output =
        agent_board::agent::hook::run("codex", &mut Cursor::new(input), &db_path, None).unwrap();
    assert!(output.contains("AGBOARD_ERROR"));
    assert!(output.contains("--project NAME is required."));
    assert!(!db_path.exists());
    let oversized = vec![b'x'; 65_537];
    let output = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(oversized),
        &db_path,
        Some("demo"),
    )
    .unwrap();
    assert!(output.contains("hook_input_too_large"));
    assert!(!db_path.exists());
}

/// Every file below `dir` with its bytes, sorted: the state a read must not change.
fn tree_of(dir: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next).unwrap().map(Result::unwrap) {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                found.push((path.clone(), std::fs::read(&path).unwrap()));
            }
        }
    }
    found.sort();
    found
}

/// A TASK.md body whose work section holds `text`, which the file store accepts.
fn task_body(text: &str) -> String {
    format!(
        "## 作業内容\n\n{text}\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Works\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n"
    )
}

fn board_with_descriptions(descriptions: &[String]) -> (tempfile::TempDir, std::path::PathBuf) {
    use agent_board::domain::{Actor, Assignee, NewCard};
    use agent_board::file_store::FileStore;
    let home = tempdir().unwrap();
    let db_path = home.path().join("shared");
    let store = FileStore::open(&db_path);
    let now = chrono::Utc::now();
    let project = store.create_project("Agent Board", now).unwrap().id;
    for (index, description) in descriptions.iter().enumerate() {
        // The description limit counts the whole TASK.md body, headings included.
        let room = 50_000 - task_body("").chars().count();
        let description: String = description.chars().take(room).collect();
        store
            .create_card(
                &project,
                NewCard {
                    title: format!("Card {index}"),
                    description: task_body(&description),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                now,
            )
            .unwrap();
    }
    (home, db_path)
}

fn hook_context(agent: &str, event: &str, db_path: &std::path::Path) -> String {
    let input = format!(r#"{{"hook_event_name":"{event}"}}"#);
    let output = agent_board::agent::hook::run(
        agent,
        &mut Cursor::new(input.into_bytes()),
        db_path,
        Some("Agent Board"),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&output).unwrap();
    parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn hook_passes_long_descriptions_whole_within_256_kib() {
    let ten_kb = "a".repeat(10 * 1024);
    let forty_kb = format!("{}\r\nend", "b".repeat(40 * 1024));
    let (_home, db_path) =
        board_with_descriptions(&[ten_kb.clone(), forty_kb, "c".repeat(30 * 1024)]);
    for (agent, event) in [
        ("claude", "PostToolUse"),
        ("claude", "SessionStart"),
        ("codex", "PostToolUse"),
        ("codex", "SessionStart"),
    ] {
        let context = hook_context(agent, event, &db_path);
        assert!(context.starts_with("AGBOARD_SNAPSHOT\n"), "{agent} {event}");
        assert!(context.len() > 50 * 1024 && context.len() <= 256 * 1024);
        let snapshot: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
        assert!(
            snapshot["cards"][0]["description"]
                .as_str()
                .unwrap()
                .contains(ten_kb.as_str())
        );
        assert!(snapshot["cards"][1]["description"].as_str().unwrap().len() > 40 * 1024);
        assert_eq!(snapshot["cards"][1]["isDraft"], false);
    }
}

#[test]
fn hook_never_reports_an_oversized_board_as_a_complete_snapshot() {
    // Two 150,000-byte descriptions are over 256 KiB together.
    let (_home, db_path) = board_with_descriptions(&["あ".repeat(50_000), "あ".repeat(50_000)]);
    for (agent, event) in [("claude", "PostToolUse"), ("codex", "SessionStart")] {
        let context = hook_context(agent, event, &db_path);
        assert!(context.starts_with("AGBOARD_ERROR\n"));
        assert!(context.contains("context_too_large"));
        assert!(context.contains("256 KiB"));
        assert!(!context.contains("AGBOARD_SNAPSHOT"));
    }
}

#[test]
fn hook_input_limit_stays_at_64_kib() {
    let (_home, db_path) = board_with_descriptions(&[]);
    let mut at_limit = br#"{"hook_event_name":"PostToolUse","x":""#.to_vec();
    at_limit.resize(64 * 1024 - 2, b'x');
    at_limit.extend_from_slice(b"\"}");
    assert_eq!(at_limit.len(), 64 * 1024);
    let ok = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(at_limit.clone()),
        &db_path,
        Some("Agent Board"),
    )
    .unwrap();
    assert!(ok.contains("AGBOARD_SNAPSHOT"));
    at_limit.push(b' ');
    let over = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(at_limit),
        &db_path,
        Some("Agent Board"),
    )
    .unwrap();
    assert!(over.contains("hook_input_too_large"));
}

#[test]
fn installed_binary_handles_hook_json_on_stdin() {
    let home = tempdir().unwrap();
    let init = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home.path())
        .args(["--project", "Agent Board", "init"])
        .output()
        .unwrap();
    assert!(init.status.success());
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home.path())
        .args(["--project", "Agent Board", "hook", "--agent", "codex"])
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
