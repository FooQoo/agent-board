//! Atomic saves of shared files: the old file survives a failed save and no
//! temporary file is left behind.

use std::fs;
use std::path::Path;

use agent_board::error::AgboardError;
use agent_board::file_store::io::{write_atomic, write_json};

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn an_atomic_save_replaces_the_file_and_leaves_no_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("task.json");
    write_atomic(&path, b"first", "task.json").unwrap();
    write_atomic(&path, b"second", "task.json").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"second");
    assert_eq!(names(dir.path()), vec!["task.json"]);
}

#[test]
fn a_failed_atomic_save_keeps_the_original_and_removes_its_temporary_file() {
    // A non-empty directory at the target makes the final rename fail, which
    // stands in for a save that fails after the new bytes were written.
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("task.json");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep.txt"), "keep").unwrap();

    let err = write_atomic(&target, b"new", "task.json").unwrap_err();

    assert!(matches!(err, AgboardError::FileError { .. }), "{err:?}");
    assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"keep");
    assert_eq!(names(dir.path()), vec!["task.json"]);
}

#[test]
fn json_is_written_with_two_space_indent_and_one_trailing_newline() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.json");
    write_json(&path, &serde_json::json!({"a": 1}), "x.json").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "{\n  \"a\": 1\n}\n");
}
