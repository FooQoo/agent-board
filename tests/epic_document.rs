//! The epic document: it is stored as `EPIC.md`, and the CLI, hook, wait, and
//! API return it as `document` and `documentPath`. Every test uses a temporary
//! data area.

mod common;

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use common::{agboard, demo_project, json_ok};
use serde_json::Value;

const DOCUMENT: &str = "---\npriority:\n  - 3\n  - 1\nextra: kept\n---\n\n# Goal\r\n\nKeep ![shot](assets/0123456789abcdef0123456789abcdef.png) as is.\n\n日本語の本文。\n";

/// The project folder, found on disk.
fn project_dir(home: &Path) -> PathBuf {
    fs::read_dir(home.join("shared").join("projects"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}

fn epic_dir(home: &Path, id: &str) -> PathBuf {
    project_dir(home).join("epics").join(id)
}

fn add_epic(home: &Path, id: &str) {
    let (code, _, err) = agboard(
        home,
        &[
            "--project",
            "Demo",
            "epic",
            "add",
            id,
            "--name",
            id,
            "--actor",
            "ai",
        ],
    );
    assert_eq!(code, 0, "epic add failed: {err}");
}

/// Write an epic's document straight to its file.
fn write_document(home: &Path, id: &str, bytes: &[u8]) {
    fs::write(epic_dir(home, id).join("EPIC.md"), bytes).unwrap();
}

fn show(home: &Path, id: &str) -> Value {
    json_ok(home, &["--project", "Demo", "epic", "show", id, "--json"])
}

fn home_with_project() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    home
}

#[test]
fn a_new_epic_is_stored_as_epic_md() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let dir = epic_dir(home.path(), "ALPHA");
    assert!(dir.join("EPIC.md").is_file());
    assert_eq!(fs::read(dir.join("EPIC.md")).unwrap(), b"");
    assert_eq!(show(home.path(), "ALPHA")["epic"]["document"], "");
}

#[test]
fn a_missing_epic_document_is_reported_and_nothing_is_made_up() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let dir = epic_dir(home.path(), "ALPHA");
    fs::remove_file(dir.join("EPIC.md")).unwrap();

    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);

    assert!(!dir.join("EPIC.md").exists());
    let problems = snapshot["problems"].to_string();
    assert!(problems.contains("epics/ALPHA/EPIC.md"), "{problems}");
}

#[test]
fn the_epic_edit_options_are_document_and_document_file() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--document",
            "# Details\n\nBy text.\n",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(
        show(home.path(), "ALPHA")["epic"]["document"],
        "# Details\n\nBy text.\n"
    );
    let file = home.path().join("details.md");
    fs::write(&file, "# Details\n\nBy file.\n").unwrap();
    let (code, _, err) = agboard(
        home.path(),
        &[
            "--project",
            "Demo",
            "epic",
            "edit",
            "ALPHA",
            "--document-file",
            file.to_str().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert!(
        show(home.path(), "ALPHA")["epic"]["document"]
            .as_str()
            .unwrap()
            .contains("By file.")
    );
    assert_eq!(
        fs::read_to_string(epic_dir(home.path(), "ALPHA").join("EPIC.md")).unwrap(),
        "# Details\n\nBy file."
    );
}

#[test]
fn json_outputs_use_document_and_document_path() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "ALPHA"],
    );
    assert_eq!(code, 0, "{err}");
    write_document(home.path(), "ALPHA", DOCUMENT.as_bytes());

    let shown = show(home.path(), "ALPHA");
    assert_eq!(shown["epic"]["document"], DOCUMENT);

    let listed = json_ok(home.path(), &["--project", "Demo", "epic", "ls", "--json"]);
    let alpha = listed["epics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|epic| epic["id"] == "ALPHA")
        .unwrap();
    assert_eq!(alpha["priority"], serde_json::json!([3, 1]));

    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    assert_eq!(snapshot["epics"][0]["document"], DOCUMENT);
    assert_eq!(snapshot["epics"][0]["priority"], serde_json::json!([3, 1]));

    let table = json_ok(home.path(), &["--project", "Demo", "progress", "--json"]);
    let document_path = table["epics"][0]["documentPath"].as_str().unwrap();
    assert!(document_path.ends_with("/EPIC.md"), "{document_path}");
    assert!(Path::new(document_path).is_file());

    let selected = json_ok(
        home.path(),
        &[
            "--project",
            "Demo",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "10",
        ],
    );
    assert!(
        selected["documentPath"]
            .as_str()
            .unwrap()
            .ends_with("/EPIC.md")
    );
}

#[test]
fn the_hook_snapshot_uses_document_path() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "ALPHA"],
    );
    assert_eq!(code, 0, "{err}");
    write_document(home.path(), "ALPHA", DOCUMENT.as_bytes());
    let input = br#"{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_input":{"command":"x"}}"#;
    let out = agent_board::agent::hook::run(
        "claude",
        &mut Cursor::new(input),
        &home.path().join("shared"),
        Some("Demo"),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&out).unwrap();
    let context = parsed["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    let table: Value = serde_json::from_str(context.split_once('\n').unwrap().1).unwrap();
    assert!(
        table["epics"][0]["documentPath"]
            .as_str()
            .unwrap()
            .ends_with("/EPIC.md")
    );
}

#[test]
fn the_api_serves_and_saves_the_document() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    write_document(home.path(), "ALPHA", DOCUMENT.as_bytes());
    let id = project_dir(home.path())
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let server = common::Running::start(home.path());
    let one = format!("/api/projects/{id}/epics/ALPHA");

    let shown = server.get(&one);
    assert_eq!(shown.status, 200, "{}", shown.body);
    assert_eq!(shown.json()["epic"]["document"], DOCUMENT);
    assert_eq!(shown.json()["epic"]["priority"], serde_json::json!([3, 1]));

    let patched = server.write("PATCH", &one, Some(r##"{"document":"# New\n"}"##));
    assert_eq!(patched.status, 200, "{}", patched.body);
    assert_eq!(patched.json()["epic"]["document"], "# New\n");
    assert_eq!(
        fs::read_to_string(epic_dir(home.path(), "ALPHA").join("EPIC.md")).unwrap(),
        "# New\n"
    );
    server.stop();
}
