//! Folder bindings: which project a local folder works on. A folder belongs
//! to one project, the nearest bound folder decides, bindings follow the
//! project's ID through renames, and nothing is guessed when a binding is
//! missing or its project was deleted. The bindings never enter the shared files.

use std::fs;
use std::path::{Path, PathBuf};

use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use assert_cmd::Command;
use chrono::{TimeZone, Utc};
use serde_json::Value;
use tempfile::{TempDir, tempdir};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 13, 0, 0, 0).unwrap()
}

/// A data root with `shared/` below it, the store on that folder, and a
/// folder tree the bindings can point at.
fn fixture() -> (TempDir, FileStore, PathBuf) {
    let root = tempdir().unwrap();
    let store = FileStore::open(&root.path().join("shared"));
    let work = root.path().join("work");
    fs::create_dir_all(work.join("x/y/z")).unwrap();
    fs::create_dir_all(work.join("x/q")).unwrap();
    fs::create_dir_all(work.join("other")).unwrap();
    let canonical = fs::canonicalize(&work).unwrap();
    (root, store, canonical)
}

#[test]
fn the_nearest_bound_folder_decides_and_an_unbound_folder_is_an_error() {
    let (_root, store, work) = fixture();
    let outer = store.create_project("Outer", now()).unwrap();
    let inner = store.create_project("Inner", now()).unwrap();
    store.bind_folder(&outer.id, &work.join("x")).unwrap();
    store.bind_folder(&inner.id, &work.join("x/y")).unwrap();

    let deep = store.project_for_folder(&work.join("x/y/z")).unwrap();
    assert_eq!(deep.id, inner.id);
    let sibling = store.project_for_folder(&work.join("x/q")).unwrap();
    assert_eq!(sibling.id, outer.id);
    let exact = store.project_for_folder(&work.join("x/y")).unwrap();
    assert_eq!(exact.id, inner.id);

    let unbound = store.project_for_folder(&work.join("other")).unwrap_err();
    assert_eq!(unbound.code(), "folder_unbound");
    assert_eq!(unbound.exit_code(), 4);
}

#[test]
fn a_folder_belongs_to_one_project_and_rebinding_it_to_the_same_project_changes_nothing() {
    let (_root, store, work) = fixture();
    let alpha = store.create_project("Alpha", now()).unwrap();
    let beta = store.create_project("Beta", now()).unwrap();

    let first = store.bind_folder(&alpha.id, &work.join("x")).unwrap();
    assert!(first.changed);
    let again = store.bind_folder(&alpha.id, &work.join("x")).unwrap();
    assert!(!again.changed);

    let refused = store.bind_folder(&beta.id, &work.join("x")).unwrap_err();
    assert_eq!(refused.code(), "folder_bound_elsewhere");
    assert_eq!(refused.exit_code(), 2);
    let bindings = store.bindings().unwrap();
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].project_id, alpha.id);
}

#[test]
fn one_project_may_have_several_folders() {
    let (_root, store, work) = fixture();
    let alpha = store.create_project("Alpha", now()).unwrap();
    store.bind_folder(&alpha.id, &work.join("x")).unwrap();
    store.bind_folder(&alpha.id, &work.join("other")).unwrap();

    assert_eq!(
        store.project_for_folder(&work.join("x/q")).unwrap().id,
        alpha.id
    );
    assert_eq!(
        store.project_for_folder(&work.join("other")).unwrap().id,
        alpha.id
    );
}

#[test]
fn a_rename_keeps_the_binding() {
    let (_root, store, work) = fixture();
    let alpha = store.create_project("Alpha", now()).unwrap();
    store.bind_folder(&alpha.id, &work.join("x")).unwrap();

    store.rename_project(&alpha.id, "Renamed").unwrap();
    let found = store.project_for_folder(&work.join("x/q")).unwrap();
    assert_eq!(found.id, alpha.id);
    assert_eq!(found.name, "Renamed");
}

#[test]
fn a_deleted_project_is_never_replaced_by_a_new_one_with_the_same_name() {
    let (_root, store, work) = fixture();
    let old = store.create_project("Alpha", now()).unwrap();
    store.bind_folder(&old.id, &work.join("x")).unwrap();
    store.delete_project(&old.id).unwrap();

    let missing = store.project_for_folder(&work.join("x/q")).unwrap_err();
    assert_eq!(missing.code(), "bound_project_missing");
    assert_eq!(missing.exit_code(), 4);

    let new = store.create_project("Alpha", now()).unwrap();
    assert_ne!(new.id, old.id);
    assert_eq!(
        store
            .project_for_folder(&work.join("x/q"))
            .unwrap_err()
            .code(),
        "bound_project_missing"
    );
}

#[test]
fn a_bindings_file_that_does_not_follow_the_format_is_an_error_not_an_empty_list() {
    let (root, store, work) = fixture();
    let alpha = store.create_project("Alpha", now()).unwrap();
    store.bind_folder(&alpha.id, &work.join("x")).unwrap();
    fs::write(root.path().join("bindings.json"), "{ not json").unwrap();

    let error: AgboardError = store.bindings().unwrap_err();
    assert_eq!(error.code(), "file_invalid");
    assert!(store.bind_folder(&alpha.id, &work.join("other")).is_err());
    assert_eq!(
        fs::read_to_string(root.path().join("bindings.json")).unwrap(),
        "{ not json"
    );
}

#[test]
fn an_unknown_folder_cannot_be_canonicalized_and_a_file_is_not_a_folder() {
    let (root, _store, work) = fixture();
    let file = work.join("note.txt");
    fs::write(&file, "x").unwrap();
    assert_eq!(
        agent_board::file_store::bindings::canonical_folder(&root.path().join("missing"))
            .unwrap_err()
            .code(),
        "invalid_value"
    );
    assert_eq!(
        agent_board::file_store::bindings::canonical_folder(&file)
            .unwrap_err()
            .code(),
        "invalid_value"
    );
}

// ---- the command line -----------------------------------------------------

fn agboard(home: &Path, cwd: &Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(cwd)
        .args(args)
        .assert()
}

fn json_ok(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_slice(&assert.success().get_output().stdout).unwrap()
}

fn error_code(assert: assert_cmd::assert::Assert, exit: i32) -> String {
    let out: Value =
        serde_json::from_slice(&assert.failure().code(exit).get_output().stderr).unwrap();
    out["error"]["code"].as_str().unwrap().to_string()
}

fn project_names(home: &Path, cwd: &Path) -> Vec<String> {
    let catalog = json_ok(agboard(home, cwd, &["project", "ls", "--json"]));
    catalog["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn project_create_binds_the_current_folder_by_default_and_refuses_a_bound_folder_before_creating() {
    let home = tempdir().unwrap();
    let work = tempdir().unwrap();
    let cwd = fs::canonicalize(work.path()).unwrap();

    agboard(home.path(), &cwd, &["project", "create", "Alpha"]).success();
    assert_eq!(project_names(home.path(), &cwd), vec!["Alpha"]);

    let refused = error_code(
        agboard(home.path(), &cwd, &["project", "create", "Beta", "--json"]),
        2,
    );
    assert_eq!(refused, "folder_bound_elsewhere");
    assert_eq!(project_names(home.path(), &cwd), vec!["Alpha"]);
}

#[test]
fn project_create_with_a_missing_folder_is_refused_and_creates_nothing() {
    let home = tempdir().unwrap();
    let cwd = fs::canonicalize(home.path()).unwrap();
    let missing = cwd.join("does-not-exist");

    let code = error_code(
        agboard(
            home.path(),
            &cwd,
            &[
                "project",
                "create",
                "Alpha",
                "--folder",
                missing.to_str().unwrap(),
                "--json",
            ],
        ),
        2,
    );
    assert_eq!(code, "invalid_value");
    assert!(project_names(home.path(), &cwd).is_empty());
}

#[test]
fn project_bind_reports_an_existing_binding_without_a_change_and_refuses_another_projects_folder() {
    let home = tempdir().unwrap();
    let a = tempdir().unwrap();
    let b = tempdir().unwrap();
    let a = fs::canonicalize(a.path()).unwrap();
    let b = fs::canonicalize(b.path()).unwrap();
    agboard(home.path(), &a, &["project", "create", "Alpha"]).success();
    agboard(home.path(), &b, &["project", "create", "Beta"]).success();

    // Beta may not take the folder that Alpha already belongs to.
    let refused = error_code(
        agboard(
            home.path(),
            &b,
            &[
                "project",
                "bind",
                "Beta",
                "--folder",
                a.to_str().unwrap(),
                "--json",
            ],
        ),
        2,
    );
    assert_eq!(refused, "folder_bound_elsewhere");

    let twice = agboard(home.path(), &a, &["project", "bind", "Alpha"])
        .success()
        .get_output()
        .stdout
        .clone();
    assert!(
        String::from_utf8(twice)
            .unwrap()
            .contains("already bound to this folder")
    );
}

#[test]
fn project_bind_names_its_project_by_argument_and_rejects_the_global_project_option() {
    let home = tempdir().unwrap();
    let cwd = fs::canonicalize(home.path()).unwrap();
    agboard(home.path(), &cwd, &["project", "create", "Alpha"]).success();

    assert_eq!(
        error_code(
            agboard(
                home.path(),
                &cwd,
                &["--project", "Alpha", "project", "bind", "Alpha", "--json"]
            ),
            2
        ),
        "invalid_argument"
    );
    assert_eq!(
        error_code(
            agboard(home.path(), &cwd, &["project", "bind", "Missing", "--json"]),
            4
        ),
        "project_not_found"
    );
}

#[test]
fn folder_paths_stay_out_of_the_shared_files() {
    let home = tempdir().unwrap();
    let cwd = fs::canonicalize(home.path()).unwrap();
    agboard(home.path(), &cwd, &["project", "create", "Alpha"]).success();

    let folder = cwd.display().to_string();
    assert!(home.path().join("bindings.json").exists());
    let mut shared_text = String::new();
    collect_text(&home.path().join("shared"), &mut shared_text);
    assert!(
        !shared_text.contains(&folder),
        "a shared file names the local folder"
    );
}

fn collect_text(dir: &Path, out: &mut String) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect_text(&path, out);
        } else if let Ok(text) = fs::read_to_string(&path) {
            out.push_str(&text);
        }
    }
}

#[test]
fn a_folder_of_a_deleted_project_can_be_bound_to_a_new_project() {
    let (_root, store, work) = fixture();
    let old = store.create_project("Alpha", now()).unwrap();
    store.bind_folder(&old.id, &work.join("x")).unwrap();
    store.delete_project(&old.id).unwrap();

    let new = store.create_project("Gamma", now()).unwrap();
    assert!(
        store
            .live_binding_for_folder(&work.join("x"))
            .unwrap()
            .is_none()
    );
    let rebound = store.bind_folder(&new.id, &work.join("x")).unwrap();
    assert!(rebound.changed);
    assert_eq!(
        store.project_for_folder(&work.join("x/q")).unwrap().id,
        new.id
    );
    assert_eq!(store.bindings().unwrap().len(), 1);
}

#[test]
fn a_project_whose_binding_fails_after_creation_is_removed_again() {
    let home = tempdir().unwrap();
    let cwd = fs::canonicalize(home.path()).unwrap();
    // The bindings lock cannot be opened, so the binding fails after the project
    // was created. Nothing may stay behind.
    fs::create_dir_all(home.path().join(".bindings.lock")).unwrap();

    let code = error_code(
        agboard(home.path(), &cwd, &["project", "create", "Alpha", "--json"]),
        1,
    );
    assert_eq!(code, "file_error");
    assert!(project_names(home.path(), &cwd).is_empty());
}
