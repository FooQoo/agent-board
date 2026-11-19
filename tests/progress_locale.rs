//! The saved language rides in the progress table as `locale`: in the hook
//! context and in `agboard progress --json`. It is left out for English and
//! when no usable language is saved, and a broken file never fails either command.

use std::io::Cursor;
use std::path::Path;
use std::process::Command;

use serde_json::Value;
use tempfile::{TempDir, tempdir};

const PREFS: &str =
    r#"{"formatVersion":1,"revision":1,"locale":"ja","theme":{"mode":"light","accent":"blue"}}"#;

fn board() -> (TempDir, std::path::PathBuf) {
    let home = tempdir().unwrap();
    let shared = home.path().join("shared");
    agent_board::file_store::FileStore::open(&shared)
        .create_project("Agent Board", chrono::Utc::now())
        .unwrap();
    (home, shared)
}

fn save_prefs(home: &Path, text: &str) {
    let dir = home.join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("preferences.json"), text).unwrap();
}

fn hook_table(shared: &Path) -> Value {
    let input = r#"{"hook_event_name":"SessionStart"}"#;
    let output = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(input.as_bytes().to_vec()),
        shared,
        Some("Agent Board"),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&output).unwrap();
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    serde_json::from_str(context.strip_prefix("AGBOARD_PROGRESS\n").unwrap()).unwrap()
}

fn cli_table(home: &Path) -> Value {
    let out = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_OPEN_BROWSER", "0")
        .env("AGBOARD_WATCH", "poll")
        .env("AGBOARD_HOME", home)
        .args(["--project", "Agent Board", "progress", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn a_saved_language_is_in_the_hook_and_the_cli_table() {
    let (home, shared) = board();
    save_prefs(home.path(), PREFS);
    assert_eq!(hook_table(&shared)["locale"], "ja");
    assert_eq!(cli_table(home.path())["locale"], "ja");
}

#[test]
fn saved_english_leaves_the_field_out() {
    let (home, shared) = board();
    save_prefs(home.path(), &PREFS.replace("\"ja\"", "\"en\""));
    assert!(hook_table(&shared).get("locale").is_none());
    assert!(cli_table(home.path()).get("locale").is_none());
}

#[test]
fn no_saved_language_leaves_the_field_out() {
    let (home, shared) = board();
    assert!(hook_table(&shared).get("locale").is_none());
    assert!(cli_table(home.path()).get("locale").is_none());
}

#[test]
fn an_invalid_preferences_file_leaves_the_field_out_without_failing() {
    let (home, shared) = board();
    for text in ["{ not json", r#"{"formatVersion":1,"locale":"fr"}"#, ""] {
        save_prefs(home.path(), text);
        assert!(hook_table(&shared).get("locale").is_none());
        assert!(cli_table(home.path()).get("locale").is_none());
    }
}
