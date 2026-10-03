//! CLI behavior for the destructive commands: `rm`, `init` over an existing
//! board, and `import` over an existing board.
//!
//! Piped runs (no terminal) and `--json` runs use the real `skan` binary with
//! `SKAN_HOME` in a temporary directory and `TZ=UTC`. The confirmation logic
//! is covered through each command's `run_with_io`. Pseudo-terminal runs
//! (Unix only) are at the end.

use std::path::Path;

use assert_cmd::Command;
use chrono::{DateTime, Utc};
use skan::cli::Context;
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
    run_with_stdin(home, args, "")
}

/// Run with `stdin` piped in (so no terminal).
fn run_with_stdin(home: &Path, args: &[&str], stdin: &str) -> Output {
    let output = skan(home).args(args).write_stdin(stdin).output().unwrap();
    Output {
        code: output.status.code().unwrap(),
        out: String::from_utf8(output.stdout).unwrap(),
        err: String::from_utf8(output.stderr).unwrap(),
    }
}

/// A tempdir with a board named "demo" holding `titles` as cards.
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

fn context(home: &Path, interactive: bool, json: bool) -> Context {
    Context {
        store: Store::open(&home.join("board.db")).unwrap(),
        clock: Box::new(FixedClock(at("2026-10-03T00:00:00Z"))),
        json,
        interactive,
    }
}

/// Everything `ls --json` shows plus every card's `show --json`.
fn state_of(home: &Path) -> Vec<serde_json::Value> {
    let ls = run(home, &["ls", "--json"]);
    assert_eq!(ls.code, 0, "{}", ls.err);
    let list = json(&ls.out);
    let mut all = vec![list.clone()];
    for card in list["cards"].as_array().unwrap() {
        let id = card["id"].as_i64().unwrap().to_string();
        let show = run(home, &["show", &id, "--json"]);
        assert_eq!(show.code, 0, "{}", show.err);
        all.push(json(&show.out));
    }
    all
}

fn titles(home: &Path) -> Vec<String> {
    let ls = run(home, &["ls", "--json"]);
    json(&ls.out)["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["title"].as_str().unwrap().to_string())
        .collect()
}

fn board_name(home: &Path) -> String {
    let store = Store::open(&home.join("board.db")).unwrap();
    store.board().unwrap().unwrap().name
}

const NEEDS_CONFIRMATION_REASON: &str =
    "Run this command yourself in a terminal. Agents cannot delete cards or replace the board.";

// -------------------------------------------- init over a board (piped)

#[test]
fn init_over_a_board_without_a_terminal_needs_confirmation_and_changes_nothing() {
    let home = board_with(&["One", "Two"]);
    let before = state_of(home.path());

    let o = run_with_stdin(home.path(), &["init", "--name", "other"], "y\n");
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        format!(
            "Error: replacing the board needs confirmation from a human.\nReason: {NEEDS_CONFIRMATION_REASON}\n"
        )
    );
    assert_eq!(state_of(home.path()), before);
    assert_eq!(board_name(home.path()), "demo");
}

#[test]
fn init_over_a_board_with_json_is_one_line_of_json_and_changes_nothing() {
    let home = board_with(&["One"]);
    let before = state_of(home.path());

    let o = run(home.path(), &["init", "--name", "other", "--json"]);
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        format!(
            "{{\"error\":{{\"code\":\"confirmation_required\",\"message\":\"replacing the board needs confirmation from a human.\",\"reason\":\"{NEEDS_CONFIRMATION_REASON}\"}}}}\n"
        )
    );
    assert_eq!(state_of(home.path()), before);
}

// ------------------------------------- init over a board (run_with_io)

use skan::cli::Outcome;
use skan::cli::args::InitArgs;
use skan::cli::commands::init;
use skan::error::SkanError;

struct Answered {
    result: Result<Outcome, SkanError>,
    prompt: String,
    unread: Vec<u8>,
}

fn answer_init(home: &Path, name: &str, input: &[u8], interactive: bool, json: bool) -> Answered {
    let ctx = context(home, interactive, json);
    let args = InitArgs {
        name: name.to_string(),
    };
    let mut cursor = std::io::Cursor::new(input.to_vec());
    let mut prompt = Vec::new();
    let result = init::run_with_io(&ctx, &args, &mut cursor, &mut prompt);
    let position = cursor.position() as usize;
    Answered {
        result,
        prompt: String::from_utf8(prompt).unwrap(),
        unread: input[position..].to_vec(),
    }
}

const REPLACE_BOARD_PROMPT: &str = "A board \"demo\" already exists. Replace it with an empty board \"other\"? All cards and history will be deleted. [y/N] ";

#[test]
fn init_over_a_board_replaces_it_on_y_or_yes() {
    for answer in ["y\n", "yes\n", "Y\n", "YeS\n", "  yes  \n", "y"] {
        let home = board_with(&["One", "Two", "Three"]);
        let a = answer_init(home.path(), "other", answer.as_bytes(), true, false);
        let outcome = a.result.unwrap_or_else(|e| panic!("{answer:?}: {e}"));
        assert!(outcome.changed, "{answer:?}");
        assert_eq!(
            outcome.human,
            "Replaced the board with an empty board \"other\".\n"
        );
        assert_eq!(a.prompt, REPLACE_BOARD_PROMPT);
        assert_eq!(board_name(home.path()), "other", "{answer:?}");
        assert_eq!(titles(home.path()), Vec::<String>::new(), "{answer:?}");
        // The next ID starts over at 1.
        let added = run(home.path(), &["add", "Fresh"]);
        assert_eq!(added.out, "Added #1 to Todo: Fresh\n", "{answer:?}");
    }
}

#[test]
fn init_over_a_board_cancels_on_anything_else_and_changes_nothing() {
    for answer in ["n\n", "\n", "", "no\n", "maybe\n", "yy\n", "yes please\n"] {
        let home = board_with(&["One", "Two"]);
        let before = state_of(home.path());
        let a = answer_init(home.path(), "other", answer.as_bytes(), true, false);
        let outcome = a.result.unwrap_or_else(|e| panic!("{answer:?}: {e}"));
        assert!(!outcome.changed, "{answer:?}");
        assert_eq!(outcome.human, "Cancelled. Nothing was changed.\n");
        assert_eq!(a.prompt, REPLACE_BOARD_PROMPT);
        assert_eq!(state_of(home.path()), before, "{answer:?}");
        assert_eq!(board_name(home.path()), "demo");
    }
}

#[test]
fn init_over_a_board_without_a_human_asks_nothing_and_changes_nothing() {
    for (interactive, json) in [(false, false), (false, true), (true, true)] {
        let home = board_with(&["One"]);
        let before = state_of(home.path());
        let a = answer_init(home.path(), "other", b"y\n", interactive, json);
        assert_eq!(
            a.result.err(),
            Some(SkanError::ConfirmationRequired {
                operation: "replacing the board".to_string()
            }),
            "interactive={interactive} json={json}"
        );
        assert_eq!(a.prompt, "");
        assert_eq!(a.unread, b"y\n");
        assert_eq!(state_of(home.path()), before);
    }
}

#[test]
fn init_without_a_board_creates_it_without_asking_in_any_mode() {
    for (interactive, json) in [(false, false), (false, true), (true, false)] {
        let home = tempfile::tempdir().unwrap();
        let a = answer_init(home.path(), "fresh", b"", interactive, json);
        let outcome = a.result.unwrap();
        assert!(outcome.changed);
        assert_eq!(outcome.human, "Created board \"fresh\".\n");
        assert_eq!(a.prompt, "");
        assert_eq!(board_name(home.path()), "fresh");
    }
}

#[test]
fn init_over_a_board_checks_the_name_before_asking() {
    let home = board_with(&["One"]);
    let a = answer_init(home.path(), "   ", b"y\n", true, false);
    assert!(matches!(a.result, Err(SkanError::InvalidValue { .. })));
    assert_eq!(a.prompt, "");
    assert_eq!(board_name(home.path()), "demo");
}

#[test]
fn init_prompt_uses_the_trimmed_name() {
    let home = board_with(&[]);
    let a = answer_init(home.path(), "  other  ", b"n\n", true, false);
    a.result.unwrap();
    assert_eq!(a.prompt, REPLACE_BOARD_PROMPT);
}

// ------------------------------------------------------- rm (piped)

#[test]
fn rm_without_a_terminal_needs_confirmation_and_deletes_nothing() {
    let home = board_with(&["One", "Two", "Three"]);
    let before = state_of(home.path());

    let o = run_with_stdin(home.path(), &["rm", "3"], "y\n");
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        format!(
            "Error: deleting a card needs confirmation from a human.\nReason: {NEEDS_CONFIRMATION_REASON}\n"
        )
    );
    assert_eq!(state_of(home.path()), before);
}

#[test]
fn rm_with_json_is_always_confirmation_required() {
    let home = board_with(&["One", "Two"]);
    let before = state_of(home.path());

    let o = run(home.path(), &["rm", "2", "--json"]);
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        format!(
            "{{\"error\":{{\"code\":\"confirmation_required\",\"message\":\"deleting a card needs confirmation from a human.\",\"reason\":\"{NEEDS_CONFIRMATION_REASON}\"}}}}\n"
        )
    );
    // The flag may come first, too.
    let o = run_with_stdin(home.path(), &["--json", "rm", "1"], "yes\n");
    assert_eq!(o.code, 1);
    assert_eq!(json(&o.err)["error"]["code"], "confirmation_required");
    assert_eq!(state_of(home.path()), before);
}

#[test]
fn rm_without_a_board_is_not_initialized() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["rm", "1"]);
    assert_eq!(o.code, 4);
}

// ------------------------------------------------ rm (run_with_io)

use skan::cli::args::RmArgs;
use skan::cli::commands::rm;

fn answer_rm(home: &Path, id: i64, input: &[u8], interactive: bool, json: bool) -> Answered {
    let ctx = context(home, interactive, json);
    let args = RmArgs { id };
    let mut cursor = std::io::Cursor::new(input.to_vec());
    let mut prompt = Vec::new();
    let result = rm::run_with_io(&ctx, &args, &mut cursor, &mut prompt);
    let position = cursor.position() as usize;
    Answered {
        result,
        prompt: String::from_utf8(prompt).unwrap(),
        unread: input[position..].to_vec(),
    }
}

#[test]
fn rm_deletes_on_y_or_yes_and_prints_deleted() {
    for answer in ["y\n", "yes\n", "Y\n", "YES\n", " yes\n", "y"] {
        let home = board_with(&["One", "Two", "Three"]);
        let a = answer_rm(home.path(), 2, answer.as_bytes(), true, false);
        let outcome = a.result.unwrap_or_else(|e| panic!("{answer:?}: {e}"));
        assert!(outcome.changed, "{answer:?}");
        assert_eq!(outcome.human, "Deleted #2.\n");
        assert_eq!(
            a.prompt, "Delete #2 \"Two\"? This cannot be undone. [y/N] ",
            "{answer:?}"
        );
        assert_eq!(titles(home.path()), vec!["One", "Three"], "{answer:?}");
    }
}

#[test]
fn rm_cancels_on_anything_else_and_deletes_nothing() {
    for answer in [
        "n\n",
        "N\n",
        "\n",
        "",
        "no\n",
        "maybe\n",
        "yes!\n",
        "\u{ff59}\n",
    ] {
        let home = board_with(&["One", "Two"]);
        let before = state_of(home.path());
        let a = answer_rm(home.path(), 2, answer.as_bytes(), true, false);
        let outcome = a.result.unwrap_or_else(|e| panic!("{answer:?}: {e}"));
        assert!(!outcome.changed, "{answer:?}");
        assert_eq!(outcome.human, "Cancelled. Nothing was changed.\n");
        assert_eq!(a.prompt, "Delete #2 \"Two\"? This cannot be undone. [y/N] ");
        assert_eq!(state_of(home.path()), before, "{answer:?}");
    }
}

#[test]
fn rm_prompt_embeds_the_title_as_it_is() {
    let home = board_with(&["Fix \"quotes\" & 日本語 [y/N]"]);
    let a = answer_rm(home.path(), 1, b"n\n", true, false);
    a.result.unwrap();
    assert_eq!(
        a.prompt,
        "Delete #1 \"Fix \"quotes\" & 日本語 [y/N]\"? This cannot be undone. [y/N] "
    );
}

#[test]
fn rm_without_a_human_asks_nothing_deletes_nothing_and_never_reads() {
    for (interactive, json) in [(false, false), (false, true), (true, true)] {
        let home = board_with(&["One"]);
        let before = state_of(home.path());
        let a = answer_rm(home.path(), 1, b"y\n", interactive, json);
        assert_eq!(
            a.result.err(),
            Some(SkanError::ConfirmationRequired {
                operation: "deleting a card".to_string()
            }),
            "interactive={interactive} json={json}"
        );
        assert_eq!(a.prompt, "");
        assert_eq!(a.unread, b"y\n");
        assert_eq!(state_of(home.path()), before);
    }
}

#[test]
fn rm_of_a_missing_card_is_card_not_found_before_asking() {
    let home = board_with(&["One"]);
    let a = answer_rm(home.path(), 9, b"y\n", true, false);
    assert_eq!(a.result.err(), Some(SkanError::CardNotFound { id: 9 }));
    assert_eq!(a.prompt, "");
    assert_eq!(titles(home.path()), vec!["One"]);
}

#[test]
fn rm_never_reuses_the_deleted_id() {
    let home = board_with(&["One", "Two"]);
    answer_rm(home.path(), 2, b"y\n", true, false)
        .result
        .unwrap();
    let added = run(home.path(), &["add", "Three"]);
    assert_eq!(added.out, "Added #3 to Todo: Three\n");
}
