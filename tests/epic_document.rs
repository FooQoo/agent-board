//! The epic document: it is stored as `EPIC.md`, an existing `PLAN.md` is
//! renamed once with its bytes unchanged, and the CLI and JSON contracts say
//! `document` and `documentPath`. Every test uses a temporary data area.

mod common;

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::{agboard, demo_project, json_ok};
use serde_json::Value;

const LEGACY: &str = "---\npriority:\n  - 3\n  - 1\nextra: kept\n---\n\n# Goal\r\n\nKeep ![shot](assets/0123456789abcdef0123456789abcdef.png) as is.\n\n日本語の本文。\n";

/// The project folder, found on disk: a CLI call would read (and migrate) the project.
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

/// Put an epic back into the stored form of an earlier version.
fn make_legacy(home: &Path, id: &str, bytes: &[u8]) {
    let dir = epic_dir(home, id);
    let _ = fs::remove_file(dir.join("EPIC.md"));
    fs::write(dir.join("PLAN.md"), bytes).unwrap();
}

fn show(home: &Path, id: &str) -> Value {
    json_ok(home, &["--project", "Demo", "epic", "show", id, "--json"])
}

fn home_with_project() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    demo_project(home.path());
    home
}

fn keys_of(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                found.push(key.clone());
                keys_of(inner, found);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| keys_of(item, found)),
        _ => {}
    }
}

fn assert_no_old_names(value: &Value, what: &str) {
    let mut keys = Vec::new();
    keys_of(value, &mut keys);
    for old in ["plan", "planPath"] {
        assert!(!keys.iter().any(|key| key == old), "{what} still has {old}");
    }
}

#[test]
fn a_new_epic_is_stored_as_epic_md() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let dir = epic_dir(home.path(), "ALPHA");
    assert!(dir.join("EPIC.md").is_file());
    assert!(!dir.join("PLAN.md").exists());
    assert_eq!(fs::read(dir.join("EPIC.md")).unwrap(), b"");
    assert_eq!(show(home.path(), "ALPHA")["epic"]["document"], "");
}

#[test]
fn plan_md_becomes_epic_md_with_the_same_bytes_and_the_epic_keeps_its_data() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "ALPHA"],
    );
    assert_eq!(code, 0, "{err}");
    make_legacy(home.path(), "ALPHA", LEGACY.as_bytes());
    let dir = epic_dir(home.path(), "ALPHA");
    let assets_before = fs::read_dir(&dir).unwrap().count();

    let shown = show(home.path(), "ALPHA");

    assert_eq!(fs::read(dir.join("EPIC.md")).unwrap(), LEGACY.as_bytes());
    assert!(!dir.join("PLAN.md").exists());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), assets_before);
    let epic = &shown["epic"];
    assert_eq!(epic["document"], LEGACY);
    assert_eq!(
        epic["body"],
        "# Goal\n\nKeep ![shot](assets/0123456789abcdef0123456789abcdef.png) as is.\n\n日本語の本文。\n"
    );
    assert_eq!(epic["priority"], serde_json::json!([3, 1]));
    assert_no_old_names(&shown, "epic show");
    let listed = json_ok(home.path(), &["--project", "Demo", "ls", "--json"]);
    assert_eq!(listed["tasks"][0]["epicId"], "ALPHA");
}

#[test]
fn running_the_migration_again_changes_nothing() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    make_legacy(home.path(), "ALPHA", LEGACY.as_bytes());
    show(home.path(), "ALPHA");
    let path = epic_dir(home.path(), "ALPHA").join("EPIC.md");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    std::thread::sleep(Duration::from_millis(1100));

    show(home.path(), "ALPHA");
    json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);

    assert_eq!(fs::read(&path).unwrap(), LEGACY.as_bytes());
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
    assert!(!path.with_file_name("PLAN.md").exists());
}

#[test]
fn both_files_present_is_a_conflict_that_changes_neither() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    add_epic(home.path(), "BETA");
    make_legacy(home.path(), "ALPHA", b"alpha plan\n");
    make_legacy(home.path(), "BETA", b"beta plan\n");
    let alpha = epic_dir(home.path(), "ALPHA");
    fs::write(alpha.join("EPIC.md"), b"alpha epic\n").unwrap();
    let beta = epic_dir(home.path(), "BETA");

    for args in [
        vec!["--project", "Demo", "epic", "show", "ALPHA", "--json"],
        vec!["--project", "Demo", "snapshot", "--json"],
    ] {
        let (code, _, err) = agboard(home.path(), &[&["--json"], &args[..]].concat());
        assert_ne!(code, 0, "{args:?} should refuse");
        let error: Value = serde_json::from_str(&err).unwrap();
        let text = error.to_string();
        assert!(text.contains("ALPHA"), "{text}");
        assert!(text.contains("epics/ALPHA/PLAN.md"), "{text}");
        assert!(text.contains("epics/ALPHA/EPIC.md"), "{text}");
    }

    assert_eq!(fs::read(alpha.join("PLAN.md")).unwrap(), b"alpha plan\n");
    assert_eq!(fs::read(alpha.join("EPIC.md")).unwrap(), b"alpha epic\n");
    // The other epic is not changed while a conflict is open.
    assert_eq!(fs::read(beta.join("PLAN.md")).unwrap(), b"beta plan\n");
    assert!(!beta.join("EPIC.md").exists());
}

#[test]
fn a_migration_stopped_part_way_continues_without_touching_finished_epics() {
    let home = home_with_project();
    for id in ["ALPHA", "BETA", "GAMMA"] {
        add_epic(home.path(), id);
    }
    // ALPHA is already migrated and edited; BETA and GAMMA still have PLAN.md.
    fs::write(
        epic_dir(home.path(), "ALPHA").join("EPIC.md"),
        b"alpha migrated\n",
    )
    .unwrap();
    make_legacy(home.path(), "BETA", b"beta old\n");
    make_legacy(home.path(), "GAMMA", b"gamma old\n");

    json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);

    for (id, bytes) in [
        ("ALPHA", &b"alpha migrated\n"[..]),
        ("BETA", b"beta old\n"),
        ("GAMMA", b"gamma old\n"),
    ] {
        let dir = epic_dir(home.path(), id);
        assert_eq!(fs::read(dir.join("EPIC.md")).unwrap(), bytes, "{id}");
        assert!(!dir.join("PLAN.md").exists(), "{id}");
    }
}

#[test]
fn an_epic_with_neither_file_is_reported_and_nothing_is_made_up() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let dir = epic_dir(home.path(), "ALPHA");
    fs::remove_file(dir.join("EPIC.md")).unwrap();

    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);

    assert!(!dir.join("EPIC.md").exists());
    assert!(!dir.join("PLAN.md").exists());
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
fn the_old_epic_edit_options_are_refused_and_not_in_the_help() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let file = home.path().join("old.md");
    fs::write(&file, "x").unwrap();
    for args in [
        vec!["--plan", "text"],
        vec!["--plan-file", file.to_str().unwrap()],
    ] {
        let mut full = vec!["--project", "Demo", "epic", "edit", "ALPHA"];
        full.extend(&args);
        let (code, _, err) = agboard(home.path(), &full);
        assert_ne!(code, 0, "{args:?}");
        assert!(
            err.contains("unexpected argument") || err.contains("usage"),
            "{err}"
        );
    }
    assert_eq!(
        fs::read(epic_dir(home.path(), "ALPHA").join("EPIC.md")).unwrap(),
        b""
    );

    let (code, help, _) = agboard(home.path(), &["epic", "edit", "--help"]);
    assert_eq!(code, 0);
    assert!(help.contains("--document"));
    assert!(help.contains("--document-file"));
    assert!(!help.contains("--plan"), "{help}");
    assert!(!help.contains("PLAN.md"), "{help}");
    let (_, help, _) = agboard(home.path(), &["epic", "--help"]);
    assert!(
        !help.contains("--plan") && !help.contains("PLAN.md"),
        "{help}"
    );
}

#[test]
fn json_outputs_use_document_names_and_never_the_old_ones() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    let (code, _, err) = agboard(
        home.path(),
        &["--project", "Demo", "edit", "1", "--epic", "ALPHA"],
    );
    assert_eq!(code, 0, "{err}");
    make_legacy(home.path(), "ALPHA", LEGACY.as_bytes());

    let shown = show(home.path(), "ALPHA");
    assert_no_old_names(&shown, "epic show");
    assert_eq!(shown["epic"]["document"], LEGACY);

    let listed = json_ok(home.path(), &["--project", "Demo", "epic", "ls", "--json"]);
    assert_no_old_names(&listed, "epic ls");

    let snapshot = json_ok(home.path(), &["--project", "Demo", "snapshot", "--json"]);
    assert_no_old_names(&snapshot, "snapshot");
    assert_eq!(snapshot["epics"][0]["document"], LEGACY);
    assert_eq!(snapshot["epics"][0]["priority"], serde_json::json!([3, 1]));

    let table = json_ok(home.path(), &["--project", "Demo", "progress", "--json"]);
    assert_no_old_names(&table, "progress");
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
    assert_no_old_names(&selected, "wait");
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
    make_legacy(home.path(), "ALPHA", LEGACY.as_bytes());
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
    assert_no_old_names(&table, "hook");
    assert!(
        table["epics"][0]["documentPath"]
            .as_str()
            .unwrap()
            .ends_with("/EPIC.md")
    );
}

#[test]
fn the_api_serves_document_and_refuses_the_old_field_names() {
    let home = home_with_project();
    add_epic(home.path(), "ALPHA");
    make_legacy(home.path(), "ALPHA", LEGACY.as_bytes());
    let id = project_dir(home.path())
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let server = common::Running::start(home.path());
    let one = format!("/api/projects/{id}/epics/ALPHA");

    let shown = server.get(&one);
    assert_eq!(shown.status, 200, "{}", shown.body);
    assert_no_old_names(&shown.json(), "epic API");
    assert_eq!(shown.json()["epic"]["document"], LEGACY);
    assert_eq!(shown.json()["epic"]["priority"], serde_json::json!([3, 1]));

    let old = server.write("PATCH", &one, Some(r##"{"plan":"# Old name\n"}"##));
    assert!(old.status >= 400, "{} {}", old.status, old.body);
    let created = server.write(
        "POST",
        &format!("/api/projects/{id}/epics"),
        Some(r##"{"id":"beta","name":"Beta","plan":"# Old name\n"}"##),
    );
    assert!(created.status >= 400, "{} {}", created.status, created.body);
    let patched = server.write("PATCH", &one, Some(r##"{"document":"# New\n"}"##));
    assert_eq!(patched.status, 200, "{}", patched.body);
    assert_eq!(patched.json()["epic"]["document"], "# New\n");
    assert_eq!(
        fs::read_to_string(epic_dir(home.path(), "ALPHA").join("EPIC.md")).unwrap(),
        "# New\n"
    );
    server.stop();
}
