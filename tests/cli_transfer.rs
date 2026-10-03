//! CLI behavior for `export` and `import`.
//!
//! Most tests run the real `skan` binary with `SKAN_HOME` in a temporary
//! directory and `TZ=UTC`. Tests that need the commit counter or a fixed clock
//! call `skan::cli::run_with` or the command's `run_with_io` in-process.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use assert_cmd::Command;
use chrono::{DateTime, Utc};
use skan::cli::{Context, Env};
use skan::clock::FixedClock;
use skan::store::Store;

// ---------------------------------------------------------------- helpers

fn skan(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("skan").unwrap();
    cmd.env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home);
    cmd
}

struct Output {
    code: i32,
    out: String,
    err: String,
}

fn run(home: &Path, args: &[&str]) -> Output {
    let output = skan(home).args(args).output().unwrap();
    Output {
        code: output.status.code().unwrap(),
        out: String::from_utf8(output.stdout).unwrap(),
        err: String::from_utf8(output.stderr).unwrap(),
    }
}

/// A tempdir with an initialized board named "demo" and `titles` as cards.
fn board_with(titles: &[&str]) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["init", "--name", "demo"]);
    assert_eq!(o.code, 0, "{}", o.err);
    for title in titles {
        let o = run(home.path(), &["add", title]);
        assert_eq!(o.code, 0, "{}", o.err);
    }
    home
}

fn at(text: &str) -> DateTime<Utc> {
    skan::clock::parse_utc(text).unwrap()
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

/// The directory as the child process sees it (symlinks resolved).
fn real(path: &Path) -> PathBuf {
    path.canonicalize().unwrap()
}

struct InProcess {
    code: i32,
    out: String,
    err: String,
    commits: usize,
}

/// Run one command in-process with a fixed clock.
fn run_at(db: &Path, now: &str, args: &[&str]) -> InProcess {
    let mut argv: Vec<OsString> = vec!["skan".into()];
    argv.extend(args.iter().map(OsString::from));
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut commits = 0usize;
    let code = {
        let mut hook = |_ctx: &Context| commits += 1;
        let mut env = Env {
            clock: Box::new(FixedClock(at(now))),
            db_path: db.to_path_buf(),
            stdout: &mut out,
            stderr: &mut err,
            after_commit: &mut hook,
        };
        skan::cli::run_with(&argv, &mut env)
    };
    InProcess {
        code,
        out: String::from_utf8(out).unwrap(),
        err: String::from_utf8(err).unwrap(),
        commits,
    }
}

#[allow(dead_code)]
fn store(home: &Path) -> Store {
    Store::open(&home.join("board.db")).unwrap()
}

// ----------------------------------------------------------------- export

#[test]
fn export_without_a_path_writes_skan_json_in_the_current_directory() {
    let home = board_with(&["First", "Second"]);
    let o = run(home.path(), &["export"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, "Exported 2 cards to ./skan.json.\n");
    assert_eq!(o.err, "");

    let file = json(&std::fs::read_to_string(home.path().join("skan.json")).unwrap());
    assert_eq!(file["format"], "skan-board");
    assert_eq!(file["version"], 1);
    assert_eq!(file["board"]["name"], "demo");
    assert_eq!(file["cards"].as_array().unwrap().len(), 2);
}

#[test]
fn export_to_a_directory_writes_skan_json_inside_it() {
    let home = board_with(&["First"]);
    std::fs::create_dir(home.path().join("backup")).unwrap();
    let o = run(home.path(), &["export", "-o", "backup"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, "Exported 1 card to ./backup/skan.json.\n");
    assert!(home.path().join("backup/skan.json").is_file());
    assert!(!home.path().join("skan.json").exists());
}

#[test]
fn export_to_a_file_path_writes_that_file() {
    let home = board_with(&["First", "Second", "Third"]);
    let o = run(home.path(), &["export", "--output", "my-board.json"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, "Exported 3 cards to ./my-board.json.\n");
    assert!(home.path().join("my-board.json").is_file());
}

#[test]
fn export_outside_the_current_directory_shows_the_absolute_path() {
    let home = board_with(&["First"]);
    let elsewhere = tempfile::tempdir().unwrap();
    let target = real(elsewhere.path()).join("out.json");
    let o = run(home.path(), &["export", "-o", target.to_str().unwrap()]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, format!("Exported 1 card to {}.\n", target.display()));
    assert!(target.is_file());
}

#[test]
fn export_json_prints_the_absolute_path_and_the_card_count() {
    let home = board_with(&["First", "Second"]);
    let o = run(home.path(), &["export", "--json"]);
    assert_eq!(o.code, 0, "{}", o.err);
    let path = real(home.path()).join("skan.json");
    assert_eq!(
        o.out,
        format!("{{\"path\":\"{}\",\"cards\":2}}\n", path.display())
    );
    assert!(path.is_file());
}

#[test]
fn export_of_an_empty_board_says_zero_cards() {
    let home = board_with(&[]);
    let o = run(home.path(), &["export"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, "Exported 0 cards to ./skan.json.\n");
}

#[test]
fn two_exports_of_the_same_board_are_identical_and_overwrite_the_file() {
    let home = board_with(&["First", "Second"]);
    let target = home.path().join("skan.json");
    std::fs::write(&target, "old contents").unwrap();
    assert_eq!(run(home.path(), &["export"]).code, 0);
    let first = std::fs::read(&target).unwrap();
    assert_ne!(first, b"old contents");
    assert_eq!(run(home.path(), &["export"]).code, 0);
    let second = std::fs::read(&target).unwrap();
    assert_eq!(first, second);
    assert_eq!(*first.last().unwrap(), b'\n');
}

#[test]
fn export_to_a_missing_directory_is_a_file_error_and_leaves_no_file() {
    let home = board_with(&["First"]);
    let o = run(home.path(), &["export", "-o", "nope/skan.json"]);
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert!(
        o.err.starts_with("Error: cannot write "),
        "unexpected: {}",
        o.err
    );
    assert!(o.err.contains("nope/skan.json."), "{}", o.err);

    let json_o = run(home.path(), &["export", "-o", "nope/skan.json", "--json"]);
    assert_eq!(json_o.code, 1);
    assert_eq!(json(&json_o.err)["error"]["code"], "file_error");
}

#[test]
fn export_without_a_board_is_not_initialized() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["export"]);
    assert_eq!(o.code, 4);
    assert!(!home.path().join("skan.json").exists());
}

#[test]
fn export_changes_nothing_so_it_does_not_notify() {
    let home = board_with(&["First"]);
    let target = home.path().join("out.json");
    let o = run_at(
        &home.path().join("board.db"),
        "2026-10-03T00:00:00Z",
        &["export", "-o", target.to_str().unwrap()],
    );
    assert_eq!(o.code, 0, "{}", o.err);
    assert!(o.out.starts_with("Exported 1 card to "), "{}", o.out);
    assert_eq!(o.commits, 0);
}
