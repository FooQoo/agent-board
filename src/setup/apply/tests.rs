//! Tests for writing planned files and rolling back.

use super::*;
use crate::setup::Agent;
use std::fs;
use std::path::{Path, PathBuf};

fn target(file: &Path, original: Option<&[u8]>, planned: &[u8]) -> Target {
    Target {
        agent: Agent::Claude,
        config_path: file.to_path_buf(),
        file: file.to_path_buf(),
        original: original.map(<[u8]>::to_vec),
        planned: Some(planned.to_vec()),
        changes: Vec::new(),
    }
}

#[test]
fn a_file_changed_after_planning_is_never_overwritten() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("settings.json");
    fs::write(&file, b"changed by someone else").unwrap();
    let stale = target(&file, Some(b"what planning saw"), b"new");
    let error = apply(&[stale]).unwrap_err();
    assert_eq!(error.code(), "file_error");
    assert!(
        error.reason().contains("nothing was overwritten"),
        "{}",
        error.reason()
    );
    assert_eq!(fs::read(&file).unwrap(), b"changed by someone else");
    assert!(backups(tmp.path()).is_empty());
}

#[test]
fn a_failure_later_in_the_run_restores_the_earlier_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let first = tmp.path().join("config.toml");
    let second = tmp.path().join("settings.json");
    fs::write(&first, b"first original").unwrap();
    fs::write(&second, b"second changed by someone else").unwrap();
    let targets = [
        target(&first, Some(b"first original"), b"first new"),
        target(&second, Some(b"second original"), b"second new"),
    ];
    let error = apply(&targets).unwrap_err();
    assert!(error.reason().contains("restored"), "{}", error.reason());
    assert_eq!(fs::read(&first).unwrap(), b"first original");
    assert_eq!(
        fs::read(&second).unwrap(),
        b"second changed by someone else"
    );
    assert!(
        backups(tmp.path()).is_empty(),
        "backups of restored files are removed"
    );
}

#[test]
fn a_new_file_is_removed_again_when_the_run_is_undone() {
    let tmp = tempfile::tempdir().unwrap();
    let created = tmp.path().join("created.json");
    let conflicting = tmp.path().join("conflict.json");
    fs::write(&conflicting, b"now present").unwrap();
    let targets = [
        target(&created, None, b"{}"),
        target(&conflicting, None, b"{}"),
    ];
    assert!(apply(&targets).is_err());
    assert!(!created.exists(), "the file this run created is removed");
    assert_eq!(fs::read(&conflicting).unwrap(), b"now present");
}

#[test]
fn a_successful_apply_backs_up_and_reports_the_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("settings.json");
    fs::write(&file, b"old").unwrap();
    let backups_seen = apply(&[target(&file, Some(b"old"), b"new")]).unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"new");
    let backup = backups_seen[0].clone().expect("backup path");
    assert_eq!(fs::read(backup).unwrap(), b"old");
}

fn backups(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.to_string_lossy().contains("agboard-"))
        .collect()
}
