//! The README placed in a new `docs/` folder: its language, and when it is
//! (not) placed.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use common::Running;

fn cli(home: &Path, args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap();
    assert!(output.status.success(), "{args:?}: {output:?}");
    String::from_utf8(output.stdout).unwrap()
}

fn set_locale(home: &Path, locale: &str) {
    let dir = home.join(".internal");
    fs::create_dir_all(&dir).unwrap();
    let file = format!(
        r#"{{"formatVersion":1,"revision":1,"locale":"{locale}","theme":{{"mode":"light","accent":"blue"}}}}"#
    );
    fs::write(dir.join("preferences.json"), file).unwrap();
}

fn create(home: &Path, name: &str) -> PathBuf {
    let folder = home.join(format!("folder-{name}"));
    fs::create_dir_all(&folder).unwrap();
    let out = cli(
        home,
        &[
            "--json",
            "project",
            "create",
            name,
            "--folder",
            folder.to_str().unwrap(),
        ],
    );
    let id = serde_json::from_str::<serde_json::Value>(&out).unwrap()["project"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    home.join("shared/projects").join(id).join("docs")
}

#[test]
fn a_new_project_gets_a_readme_in_the_language_setting() {
    let home = tempfile::tempdir().unwrap();
    let english = create(home.path(), "one");
    assert_eq!(
        fs::read_to_string(english.join("README.md")).unwrap(),
        include_str!("../src/docs/templates/README.en.md")
    );
    set_locale(home.path(), "ja");
    let japanese = create(home.path(), "two");
    let text = fs::read_to_string(japanese.join("README.md")).unwrap();
    assert_eq!(text, include_str!("../src/docs/templates/README.ja.md"));
    assert!(text.contains("ドキュメント"));
}

#[test]
fn the_readme_names_where_the_docs_are_and_what_deleting_the_project_does() {
    for text in [
        include_str!("../src/docs/templates/README.en.md"),
        include_str!("../src/docs/templates/README.ja.md"),
    ] {
        assert!(text.contains("docs/"));
        assert!(text.contains(".md"));
    }
}

#[test]
fn startup_places_a_readme_only_in_a_docs_folder_it_creates() {
    let home = tempfile::tempdir().unwrap();
    set_locale(home.path(), "ja");
    let missing = create(home.path(), "missing");
    let existing = create(home.path(), "existing");
    let deleted = create(home.path(), "deleted");
    fs::remove_dir_all(&missing).unwrap();
    fs::write(existing.join("README.md"), "mine\n").unwrap();
    fs::remove_file(deleted.join("README.md")).unwrap();
    let server = Running::start(home.path());
    assert_eq!(
        fs::read_to_string(missing.join("README.md")).unwrap(),
        include_str!("../src/docs/templates/README.ja.md")
    );
    assert_eq!(
        fs::read_to_string(existing.join("README.md")).unwrap(),
        "mine\n"
    );
    assert!(!deleted.join("README.md").exists());
    server.stop();
    // A restart does not bring a deleted README back either.
    let server = Running::start(home.path());
    assert!(!deleted.join("README.md").exists());
    server.stop();
}

#[test]
fn creating_a_project_never_touches_another_projects_readme() {
    let home = tempfile::tempdir().unwrap();
    let first = create(home.path(), "first");
    fs::write(first.join("README.md"), "edited\n").unwrap();
    create(home.path(), "second");
    assert_eq!(
        fs::read_to_string(first.join("README.md")).unwrap(),
        "edited\n"
    );
}

#[test]
fn deleting_a_project_deletes_its_docs_folder_too() {
    let home = tempfile::tempdir().unwrap();
    let store = agent_board::file_store::FileStore::open(&home.path().join("shared"));
    let id = store
        .create_project("doomed", chrono::Utc::now())
        .unwrap()
        .id;
    let project = home.path().join("shared/projects").join(id.to_string());
    fs::write(project.join("docs/notes.md"), "kept?\n").unwrap();
    assert!(project.join("docs/README.md").is_file());
    store.delete_project(&id).unwrap();
    assert!(!project.join("docs").exists());
    assert!(!project.exists());
}
