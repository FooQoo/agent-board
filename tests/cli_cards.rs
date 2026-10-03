//! CLI behavior for `init` (new board), `add`, `edit`, `mv`, `state`, `ls`,
//! `show`, the help text, and the error output.
//!
//! Most tests run the real `skan` binary with `SKAN_HOME` in a temporary
//! directory and `TZ=UTC`. Tests that need a fixed clock or the commit counter
//! call `skan::cli::run_with` in-process instead.

use std::ffi::OsString;
use std::path::Path;

use assert_cmd::Command;
use chrono::{DateTime, Utc};
use skan::cli::{Context, Env};
use skan::clock::FixedClock;
use skan::domain::{Column, RunState};
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

fn init(home: &Path) {
    let o = run(home, &["init", "--name", "demo"]);
    assert_eq!(o.code, 0, "{}", o.err);
}

/// A tempdir with an initialized board named "demo".
fn board() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    home
}

fn add(home: &Path, title: &str) {
    let o = run(home, &["add", title]);
    assert_eq!(o.code, 0, "{}", o.err);
}

fn at(text: &str) -> DateTime<Utc> {
    skan::clock::parse_utc(text).unwrap()
}

fn store(home: &Path) -> Store {
    Store::open(&home.join("board.db")).unwrap()
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

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

fn card_ids(home: &Path) -> Vec<i64> {
    let o = run(home, &["ls", "--json"]);
    json(&o.out)["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_i64().unwrap())
        .collect()
}

// ------------------------------------------------------------------- help

const TOP_HELP: &str = "\
skan - a local kanban board for coding agents

Usage: skan [--json] <COMMAND>

Commands:
  init    Create the board
  add     Add a card to Todo
  edit    Change a card's title or description
  mv      Move a card to todo, doing, or done
  state   Report a card's run state: idle, running, or pending
  rm      Delete a card (humans only; asks for confirmation)
  ls      List cards
  show    Show a card and its history
  export  Write the board to a JSON file
  import  Restore the board from a JSON file
  serve   Show the board in your browser

Rules for agents:
  - Move a card to doing before you report running or pending.
  - Report pending with --reason when you are waiting for something.
  - Moving a card to todo or done resets it to idle.
  - You cannot delete cards or replace the board. Ask a human to do it.
  - Add --json to any command for machine-readable output.
";

#[test]
fn top_level_help_is_the_design_text_and_exits_0() {
    let home = tempfile::tempdir().unwrap();
    for flag in ["--help", "-h"] {
        let o = run(home.path(), &[flag]);
        assert_eq!(o.code, 0, "{flag}");
        assert_eq!(o.out.trim_end(), TOP_HELP.trim_end(), "{flag}");
        assert_eq!(o.err, "");
    }
}

#[test]
fn help_does_not_need_a_board_or_create_one() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["--help"]);
    assert_eq!(o.code, 0);
    assert!(!home.path().join("board.db").exists());
}

#[test]
fn version_exits_0() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["--version"]);
    assert_eq!(o.code, 0);
    assert_eq!(o.out, format!("skan {}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn every_subcommand_help_has_an_example() {
    let home = tempfile::tempdir().unwrap();
    for name in [
        "init", "add", "edit", "mv", "state", "rm", "ls", "show", "export", "import", "serve",
    ] {
        let o = run(home.path(), &[name, "--help"]);
        assert_eq!(o.code, 0, "{name}");
        assert!(o.out.contains("Examples:"), "{name}: {}", o.out);
        assert!(
            o.out
                .lines()
                .any(|l| l.trim_start().starts_with(&format!("skan {name}"))),
            "{name}: {}",
            o.out
        );
        assert_eq!(o.err, "", "{name}");
    }
}

#[test]
fn subcommand_help_lists_its_options() {
    let home = tempfile::tempdir().unwrap();
    let add = run(home.path(), &["add", "--help"]).out;
    for needle in ["<TITLE>", "--desc <TEXT>", "--desc-file <PATH>", "--json"] {
        assert!(add.contains(needle), "{needle}: {add}");
    }
    let state = run(home.path(), &["state", "--help"]).out;
    for needle in [
        "<ID>",
        "<STATE>",
        "--reason <TEXT>",
        "idle",
        "running",
        "pending",
    ] {
        assert!(state.contains(needle), "{needle}: {state}");
    }
}

// ------------------------------------------------- errors and the run flow

#[test]
fn add_without_a_board_is_not_initialized() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["add", "x"]);
    assert_eq!(o.code, 4);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        "Error: no board found.\n\
         Reason: Run \"skan init --name <name>\" to create one, or \"skan import\" to restore one.\n"
    );
}

#[test]
fn json_errors_are_one_line_with_code_message_reason() {
    let home = tempfile::tempdir().unwrap();
    for args in [["--json", "add", "x"], ["add", "x", "--json"]] {
        let o = run(home.path(), &args);
        assert_eq!(o.code, 4);
        assert_eq!(o.out, "");
        assert_eq!(
            o.err,
            "{\"error\":{\"code\":\"not_initialized\",\"message\":\"no board found.\",\
             \"reason\":\"Run \\\"skan init --name <name>\\\" to create one, or \\\"skan import\\\" to restore one.\"}}\n"
        );
    }
}

#[test]
fn every_board_command_needs_a_board() {
    let home = tempfile::tempdir().unwrap();
    for args in [
        vec!["edit", "1", "--title", "x"],
        vec!["mv", "1", "doing"],
        vec!["state", "1", "idle"],
        vec!["ls"],
        vec!["show", "1"],
        vec!["rm", "1"],
        vec!["export"],
        vec!["serve"],
    ] {
        let o = run(home.path(), &args);
        assert_eq!(o.code, 4, "{args:?}: {}", o.err);
        assert!(o.err.starts_with("Error: no board found.\n"), "{args:?}");
    }
}

#[test]
fn argument_errors_exit_2_as_invalid_argument() {
    let home = board();
    let cases: Vec<(Vec<&str>, &str)> = vec![
        (vec!["add"], "add"),
        (vec!["add", "x", "--bogus"], "add"),
        (vec!["mv", "1", "sideways"], "mv"),
        (vec!["state", "1", "sleeping"], "state"),
        (vec!["mv", "abc", "todo"], "mv"),
        (vec!["ls", "--column", "nope"], "ls"),
        (vec!["serve", "--port", "99999"], "serve"),
    ];
    for (args, command) in cases {
        let o = run(home.path(), &args);
        assert_eq!(o.code, 2, "{args:?}: {}", o.err);
        assert_eq!(o.out, "");
        assert!(o.err.starts_with("Error: "), "{args:?}: {}", o.err);
        assert!(
            o.err.ends_with(&format!(
                "Reason: Run \"skan {command} --help\" for usage.\n"
            )),
            "{args:?}: {}",
            o.err
        );
        let mut with_json = args.clone();
        with_json.push("--json");
        let j = run(home.path(), &with_json);
        assert_eq!(j.code, 2);
        let v = json(&j.err);
        assert_eq!(v["error"]["code"], "invalid_argument");
        assert_eq!(
            v["error"]["reason"],
            format!("Run \"skan {command} --help\" for usage.")
        );
    }
}

#[test]
fn unknown_command_and_no_command_point_to_top_level_help() {
    let home = board();
    for args in [vec!["frobnicate"], vec![]] {
        let o = run(home.path(), &args);
        assert_eq!(o.code, 2, "{args:?}");
        assert!(
            o.err.ends_with("Reason: Run \"skan --help\" for usage.\n"),
            "{}",
            o.err
        );
    }
}

#[test]
fn invalid_value_message_lists_the_choices() {
    let home = board();
    let o = run(home.path(), &["mv", "1", "sideways"]);
    assert!(
        o.err.contains("invalid value 'sideways'")
            && o.err.contains("[possible values: todo, doing, done]"),
        "{}",
        o.err
    );
}

#[test]
fn unimplemented_commands_exit_1_with_not_implemented() {
    let home = board();
    add(home.path(), "x");
    for args in [
        vec!["rm", "1"],
        vec!["export"],
        vec!["serve"],
        vec!["init", "--name", "again"],
    ] {
        let o = run(home.path(), &args);
        assert_eq!(o.code, 1, "{args:?}");
        assert_eq!(o.out, "");
        assert!(o.err.starts_with("Error: "), "{args:?}: {}", o.err);
        let mut with_json = args.clone();
        with_json.push("--json");
        let v = json(&run(home.path(), &with_json).err);
        assert_eq!(v["error"]["code"], "not_implemented", "{args:?}");
    }
    // import does not need a board, so it reaches the stub on an empty home too.
    let empty = tempfile::tempdir().unwrap();
    let o = run(empty.path(), &["import"]);
    assert_eq!(o.code, 1);
    assert!(
        o.err.contains("import is not implemented yet."),
        "{}",
        o.err
    );
    // nothing was changed by any of them
    assert_eq!(card_ids(home.path()), vec![1]);
}

// ------------------------------------------------------------------- init

#[test]
fn init_creates_the_board() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["init", "--name", "demo"]);
    assert_eq!(
        (o.code, o.out.as_str(), o.err.as_str()),
        (0, "Created board \"demo\".\n", "")
    );
    let meta = store(home.path()).board().unwrap().unwrap();
    assert_eq!((meta.name.as_str(), meta.next_card_id), ("demo", 1));
}

#[test]
fn init_json_has_name_next_card_id_created_at() {
    let db = tempfile::tempdir().unwrap();
    let o = run_at(
        &db.path().join("board.db"),
        "2026-10-02T01:00:00Z",
        &["init", "--name", "demo", "--json"],
    );
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(
        o.out,
        "{\"board\":{\"name\":\"demo\",\"next_card_id\":1,\"created_at\":\"2026-10-02T01:00:00Z\"}}\n"
    );
}

#[test]
fn init_validates_the_name() {
    let home = tempfile::tempdir().unwrap();
    for name in ["", "   ", "a\nb"] {
        let o = run(home.path(), &["init", "--name", name]);
        assert_eq!(o.code, 2, "{name:?}");
        assert!(o.err.starts_with("Error: name is invalid.\n"), "{}", o.err);
    }
    let long = "n".repeat(51);
    let o = run(home.path(), &["init", "--name", &long]);
    assert_eq!(o.code, 2);
    assert_eq!(
        o.err,
        "Error: name is invalid.\nReason: Board names must be 1 to 50 characters on one line.\n"
    );
    assert!(store(home.path()).board().unwrap().is_none());
}

#[test]
fn init_requires_a_name() {
    let home = tempfile::tempdir().unwrap();
    let o = run(home.path(), &["init"]);
    assert_eq!(o.code, 2);
    assert!(
        o.err
            .ends_with("Reason: Run \"skan init --help\" for usage.\n")
    );
}

// -------------------------------------------------------------------- add

#[test]
fn add_puts_a_card_at_the_end_of_todo() {
    let home = board();
    let a = run(home.path(), &["add", "Write the setup guide"]);
    assert_eq!(
        (a.code, a.out.as_str(), a.err.as_str()),
        (0, "Added #1 to Todo: Write the setup guide\n", "")
    );
    let b = run(home.path(), &["add", "  Second  "]);
    assert_eq!(b.out, "Added #2 to Todo: Second\n");
    assert_eq!(card_ids(home.path()), vec![1, 2]);
}

#[test]
fn add_json_is_the_card_in_model_key_order() {
    let db = tempfile::tempdir().unwrap();
    let db = db.path().join("board.db");
    run_at(&db, "2026-10-02T00:00:00Z", &["init", "--name", "demo"]);
    let o = run_at(
        &db,
        "2026-10-02T01:08:00Z",
        &["add", "Write the setup guide", "--desc", "Steps", "--json"],
    );
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(
        o.out,
        concat!(
            "{\"card\":{\"id\":1,\"title\":\"Write the setup guide\",\"description\":\"Steps\",",
            "\"column\":\"todo\",\"position\":1,\"run_state\":\"idle\",\"pending_reason\":null,",
            "\"created_at\":\"2026-10-02T01:08:00Z\",\"updated_at\":\"2026-10-02T01:08:00Z\",",
            "\"run_state_changed_at\":\"2026-10-02T01:08:00Z\",",
            "\"transitions\":[{\"from\":null,\"to\":\"todo\",\"at\":\"2026-10-02T01:08:00Z\"}]}}\n"
        )
    );
}

#[test]
fn add_takes_the_description_from_an_argument_a_file_or_stdin() {
    let home = board();
    let text = "Line one\nLine two";
    std::fs::write(home.path().join("desc.txt"), text).unwrap();
    run(home.path(), &["add", "by arg", "--desc", text]);
    run(home.path(), &["add", "by file", "--desc-file", "desc.txt"]);
    let o = skan(home.path())
        .args(["add", "by stdin", "--desc", "-"])
        .write_stdin(text)
        .output()
        .unwrap();
    assert!(o.status.success());
    for id in ["1", "2", "3"] {
        let v = json(&run(home.path(), &["show", id, "--json"]).out);
        assert_eq!(v["card"]["description"], text, "card {id}");
    }
}

#[test]
fn add_drops_one_trailing_newline_from_file_and_stdin_descriptions() {
    let home = board();
    std::fs::write(home.path().join("d.txt"), "Text\r\n").unwrap();
    run(home.path(), &["add", "f", "--desc-file", "d.txt"]);
    let o = skan(home.path())
        .args(["add", "s", "--desc", "-"])
        .write_stdin("Text\n")
        .output()
        .unwrap();
    assert!(o.status.success());
    for id in ["1", "2"] {
        let v = json(&run(home.path(), &["show", id, "--json"]).out);
        assert_eq!(v["card"]["description"], "Text", "card {id}");
    }
}

#[test]
fn add_with_two_description_sources_is_an_argument_error() {
    let home = board();
    std::fs::write(home.path().join("d.txt"), "x").unwrap();
    let o = run(
        home.path(),
        &["add", "t", "--desc", "a", "--desc-file", "d.txt"],
    );
    assert_eq!(o.code, 2, "{}", o.err);
    assert!(
        o.err
            .ends_with("Reason: Run \"skan add --help\" for usage.\n")
    );
    assert_eq!(card_ids(home.path()), Vec::<i64>::new());
}

#[test]
fn add_with_a_missing_description_file_is_a_file_error() {
    let home = board();
    let o = run(home.path(), &["add", "t", "--desc-file", "nope.txt"]);
    assert_eq!(o.code, 1);
    assert!(
        o.err.starts_with("Error: cannot read nope.txt.\nReason: "),
        "{}",
        o.err
    );
    assert_eq!(card_ids(home.path()), Vec::<i64>::new());
}

#[test]
fn add_rejects_bad_titles_and_descriptions_and_changes_nothing() {
    let home = board();
    let title101 = "t".repeat(101);
    let o = run(home.path(), &["add", &title101]);
    assert_eq!(o.code, 2);
    assert_eq!(
        o.err,
        "Error: title is invalid.\nReason: Titles must be 1 to 100 characters on one line.\n"
    );
    let v = json(&run(home.path(), &["add", &title101, "--json"]).err);
    assert_eq!(v["error"]["code"], "invalid_value");

    let desc301 = "d".repeat(301);
    let o = run(home.path(), &["add", "ok", "--desc", &desc301]);
    assert_eq!(o.code, 2);
    assert_eq!(
        o.err,
        "Error: description is invalid.\n\
         Reason: Descriptions must be 300 characters or fewer. This one has 301.\n"
    );
    for bad in ["", "   ", "two\nlines"] {
        assert_eq!(run(home.path(), &["add", bad]).code, 2, "{bad:?}");
    }
    assert_eq!(card_ids(home.path()), Vec::<i64>::new());
    // the failures did not use up an ID
    assert_eq!(
        run(home.path(), &["add", "first"]).out,
        "Added #1 to Todo: first\n"
    );
    // the limits themselves are fine
    let title100 = "t".repeat(100);
    let desc300 = "d".repeat(300);
    assert_eq!(
        run(home.path(), &["add", &title100, "--desc", &desc300]).code,
        0
    );
}

#[test]
fn add_counts_characters_not_bytes() {
    let home = board();
    let title = "あ".repeat(100);
    assert_eq!(run(home.path(), &["add", &title]).code, 0);
}

// ------------------------------------------------------------------- show

#[test]
fn show_prints_the_card_and_its_history() {
    let home = board();
    let s = store(home.path());
    s.add_card(
        "Initialize the board",
        "Create the storage for the board with skan init.",
        at("2026-10-01T16:00:00Z"),
    )
    .unwrap();
    s.move_card(1, Column::Doing, at("2026-10-01T16:30:00Z"))
        .unwrap();
    s.move_card(1, Column::Done, at("2026-10-02T09:48:00Z"))
        .unwrap();
    let o = run(home.path(), &["show", "1"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(
        o.out,
        "\
#1  Initialize the board
Column:   Done
State:    idle
Created:  10/01 16:00
Updated:  10/02 09:48

Create the storage for the board with skan init.

History
  Created -> Todo   10/01 16:00
  Todo -> Doing     10/01 16:30
  Doing -> Done     10/02 09:48
"
    );
}

#[test]
fn show_says_no_description_and_shows_a_pending_reason() {
    let home = board();
    let s = store(home.path());
    s.add_card("Restore a board", "", at("2026-10-02T00:20:00Z"))
        .unwrap();
    s.move_card(1, Column::Doing, at("2026-10-02T01:10:00Z"))
        .unwrap();
    s.set_run_state(
        1,
        RunState::Pending,
        Some("Waiting for review"),
        at("2026-10-02T01:36:00Z"),
    )
    .unwrap();
    let o = run(home.path(), &["show", "1"]);
    assert_eq!(
        o.out,
        "\
#1  Restore a board
Column:   Doing
State:    pending
Reason:   Waiting for review
Created:  10/02 00:20
Updated:  10/02 01:36

(no description)

History
  Created -> Todo   10/02 00:20
  Todo -> Doing     10/02 01:10
"
    );
}

#[test]
fn show_keeps_description_line_breaks() {
    let home = board();
    run(home.path(), &["add", "t", "--desc", "one\ntwo\n\nfour"]);
    let o = run(home.path(), &["show", "1"]);
    assert!(
        o.out.contains("\n\none\ntwo\n\nfour\n\nHistory\n"),
        "{}",
        o.out
    );
}

#[test]
fn show_json_is_the_card_with_transitions() {
    let home = board();
    add(home.path(), "x");
    run(home.path(), &["mv", "1", "doing"]);
    let o = run(home.path(), &["show", "1", "--json"]);
    assert!(
        o.out.starts_with(
            "{\"card\":{\"id\":1,\"title\":\"x\",\"description\":\"\",\"column\":\"doing\","
        ),
        "{}",
        o.out
    );
    let v = json(&o.out);
    assert_eq!(v["card"]["transitions"].as_array().unwrap().len(), 2);
    assert_eq!(v["card"]["transitions"][1]["from"], "todo");
}

// --------------------------------------------------------------------- ls

/// The example board from the design: #8..#15 with several IDs missing.
fn design_board() -> tempfile::TempDir {
    let home = board();
    let s = store(home.path());
    let t = |m: u32| at(&format!("2026-10-02T01:{m:02}:00Z"));
    let titles = [
        (8, "Initialize the board"),
        (9, "Return the card list as JSON"),
        (11, "Implement card moves"),
        (12, "Restore a board from JSON"),
        (13, "Check the board display"),
        (14, "Prepare the Windows build"),
        (15, "Write the setup guide"),
    ];
    for id in 1..=15 {
        let title = titles
            .iter()
            .find(|(i, _)| *i == id)
            .map_or("filler", |(_, t)| *t);
        s.add_card(title, "", t(id as u32)).unwrap();
    }
    for id in [8, 9] {
        s.move_card(id, Column::Done, t(20 + id as u32)).unwrap();
    }
    for id in [11, 12, 13] {
        s.move_card(id, Column::Doing, t(30 + id as u32)).unwrap();
    }
    s.set_run_state(11, RunState::Running, None, t(50)).unwrap();
    s.set_run_state(
        12,
        RunState::Pending,
        Some("Waiting for confirmation on how to replace a board"),
        t(51),
    )
    .unwrap();
    for id in [1, 2, 3, 4, 5, 6, 7, 10] {
        s.delete_card(id).unwrap();
    }
    home
}

const DESIGN_LS: &str = "\
Todo (2)
  #14  Prepare the Windows build
  #15  Write the setup guide
Doing (3)
  #11  Implement card moves          running
  #12  Restore a board from JSON     pending: Waiting for confirmation on how to replace a board
  #13  Check the board display       idle
Done (2)
  #9   Return the card list as JSON
  #8   Initialize the board
";

#[test]
fn ls_matches_the_design_example() {
    let home = design_board();
    let o = run(home.path(), &["ls"]);
    assert_eq!(o.code, 0, "{}", o.err);
    assert_eq!(o.out, DESIGN_LS);
}

#[test]
fn ls_filters_by_column_and_state() {
    let home = design_board();
    assert_eq!(
        run(home.path(), &["ls", "--column", "done"]).out,
        "Done (2)\n  #9   Return the card list as JSON\n  #8   Initialize the board\n"
    );
    assert_eq!(
        run(
            home.path(),
            &["ls", "--column", "doing", "--state", "pending"]
        )
        .out,
        "Doing (1)\n  #12  Restore a board from JSON  pending: Waiting for confirmation on how to replace a board\n"
    );
    assert_eq!(
        run(home.path(), &["ls", "--state", "running"]).out,
        "Todo (0)\n  (none)\nDoing (1)\n  #11  Implement card moves  running\nDone (0)\n  (none)\n"
    );
    assert_eq!(
        run(
            home.path(),
            &["ls", "--column", "todo", "--state", "running"]
        )
        .out,
        "Todo (0)\n  (none)\n"
    );
}

#[test]
fn ls_on_an_empty_board_shows_none_for_every_column() {
    let home = board();
    assert_eq!(
        run(home.path(), &["ls"]).out,
        "Todo (0)\n  (none)\nDoing (0)\n  (none)\nDone (0)\n  (none)\n"
    );
    assert_eq!(run(home.path(), &["ls", "--json"]).out, "{\"cards\":[]}\n");
}

#[test]
fn ls_json_lists_cards_in_display_order() {
    let home = design_board();
    let o = run(home.path(), &["ls", "--json"]);
    assert_eq!(o.code, 0);
    assert!(o.out.starts_with("{\"cards\":[{\"id\":14,"), "{}", o.out);
    assert_eq!(card_ids(home.path()), vec![14, 15, 11, 12, 13, 9, 8]);
    let filtered = json(&run(home.path(), &["ls", "--json", "--column", "done"]).out);
    assert_eq!(filtered["cards"].as_array().unwrap().len(), 2);
}

#[test]
fn ls_pads_ids_and_titles_to_a_common_width() {
    let home = board();
    for t in ["a", "longer title"] {
        add(home.path(), t);
    }
    run(home.path(), &["mv", "2", "doing"]);
    assert_eq!(
        run(home.path(), &["ls"]).out,
        "Todo (1)\n  #1  a\nDoing (1)\n  #2  longer title  idle\nDone (0)\n  (none)\n"
    );
}

// ------------------------------------------------------------------- edit

#[test]
fn edit_changes_only_the_given_fields() {
    let home = board();
    run(
        home.path(),
        &["add", "Old title", "--desc", "Old description"],
    );
    let o = run(home.path(), &["edit", "1", "--title", "New title"]);
    assert_eq!((o.code, o.out.as_str()), (0, "Updated #1.\n"));
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(v["card"]["title"], "New title");
    assert_eq!(v["card"]["description"], "Old description");

    run(home.path(), &["edit", "1", "--desc", "New description"]);
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(v["card"]["title"], "New title");
    assert_eq!(v["card"]["description"], "New description");

    std::fs::write(home.path().join("d.txt"), "From a file").unwrap();
    run(
        home.path(),
        &["edit", "1", "--desc-file", "d.txt", "--title", "T3"],
    );
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(
        (
            v["card"]["title"].as_str(),
            v["card"]["description"].as_str()
        ),
        (Some("T3"), Some("From a file"))
    );
}

#[test]
fn edit_reads_a_description_from_stdin_and_can_clear_it() {
    let home = board();
    run(home.path(), &["add", "t", "--desc", "something"]);
    let o = skan(home.path())
        .args(["edit", "1", "--desc", "-"])
        .write_stdin("from stdin")
        .output()
        .unwrap();
    assert!(o.status.success());
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(v["card"]["description"], "from stdin");
    let o = run(home.path(), &["edit", "1", "--desc", ""]);
    assert_eq!(o.out, "Updated #1.\n");
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(v["card"]["description"], "");
}

#[test]
fn edit_without_a_change_says_unchanged() {
    let home = board();
    run(home.path(), &["add", "Same", "--desc", "Same text"]);
    let o = run(
        home.path(),
        &["edit", "1", "--title", "Same", "--desc", "Same text"],
    );
    assert_eq!((o.code, o.out.as_str()), (0, "#1 is unchanged.\n"));
    let j = run(home.path(), &["edit", "1", "--title", "Same", "--json"]);
    assert_eq!(j.code, 0);
    assert_eq!(json(&j.out)["card"]["id"], 1);
}

#[test]
fn edit_without_any_field_is_an_argument_error() {
    let home = board();
    add(home.path(), "x");
    let o = run(home.path(), &["edit", "1"]);
    assert_eq!(o.code, 2);
    assert!(o.err.starts_with("Error: "), "{}", o.err);
    assert!(
        o.err
            .ends_with("Reason: Run \"skan edit --help\" for usage.\n"),
        "{}",
        o.err
    );
    let v = json(&run(home.path(), &["edit", "1", "--json"]).err);
    assert_eq!(v["error"]["code"], "invalid_argument");
}

#[test]
fn edit_rejects_bad_values_and_changes_nothing() {
    let home = board();
    run(home.path(), &["add", "Keep", "--desc", "Keep too"]);
    let o = run(home.path(), &["edit", "1", "--title", ""]);
    assert_eq!(o.code, 2);
    assert!(o.err.starts_with("Error: title is invalid.\n"));
    let too_long = "d".repeat(301);
    let o = run(
        home.path(),
        &["edit", "1", "--title", "New", "--desc", &too_long],
    );
    assert_eq!(o.code, 2);
    assert!(o.err.starts_with("Error: description is invalid.\n"));
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(
        (
            v["card"]["title"].as_str(),
            v["card"]["description"].as_str()
        ),
        (Some("Keep"), Some("Keep too"))
    );
}

#[test]
fn edit_json_is_the_updated_card() {
    let home = board();
    add(home.path(), "x");
    let v = json(&run(home.path(), &["edit", "1", "--title", "y", "--json"]).out);
    assert_eq!(v["card"]["title"], "y");
}

// --------------------------------------------------------------------- mv

#[test]
fn mv_reports_the_move_and_the_same_column() {
    let home = board();
    add(home.path(), "x");
    let o = run(home.path(), &["mv", "1", "doing"]);
    assert_eq!((o.code, o.out.as_str()), (0, "Moved #1 to Doing.\n"));
    let o = run(home.path(), &["mv", "1", "doing"]);
    assert_eq!((o.code, o.out.as_str()), (0, "#1 is already in Doing.\n"));
    let o = run(home.path(), &["mv", "1", "done"]);
    assert_eq!(o.out, "Moved #1 to Done.\n");
    let o = run(home.path(), &["mv", "1", "todo"]);
    assert_eq!(o.out, "Moved #1 to Todo.\n");
}

#[test]
fn mv_to_todo_or_done_says_idle_when_the_state_was_reset() {
    let home = board();
    add(home.path(), "a");
    add(home.path(), "b");
    for (id, state, target, label) in [
        ("1", "running", "todo", "Todo"),
        ("2", "pending", "done", "Done"),
    ] {
        run(home.path(), &["mv", id, "doing"]);
        run(home.path(), &["state", id, state]);
        let o = run(home.path(), &["mv", id, target]);
        assert_eq!(
            o.out,
            format!("Moved #{id} to {label}.\n#{id} is now idle.\n"),
            "{state} -> {target}"
        );
        let v = json(&run(home.path(), &["show", id, "--json"]).out);
        assert_eq!(v["card"]["run_state"], "idle");
    }
}

#[test]
fn mv_to_doing_keeps_the_run_state_line_out() {
    let home = board();
    add(home.path(), "a");
    let o = run(home.path(), &["mv", "1", "doing"]);
    assert_eq!(o.out, "Moved #1 to Doing.\n");
}

#[test]
fn mv_json_is_the_card_even_when_nothing_moved() {
    let home = board();
    add(home.path(), "a");
    let v = json(&run(home.path(), &["mv", "1", "doing", "--json"]).out);
    assert_eq!(v["card"]["column"], "doing");
    assert_eq!(v["card"]["transitions"].as_array().unwrap().len(), 2);
    let v = json(&run(home.path(), &["mv", "1", "doing", "--json"]).out);
    assert_eq!(v["card"]["transitions"].as_array().unwrap().len(), 2);
}

#[test]
fn mv_puts_the_card_at_the_end_of_the_target_column() {
    let home = board();
    for t in ["a", "b", "c"] {
        add(home.path(), t);
    }
    run(home.path(), &["mv", "3", "doing"]);
    run(home.path(), &["mv", "1", "doing"]);
    assert_eq!(card_ids(home.path()), vec![2, 3, 1]);
}

// ------------------------------------------------------------------ state

#[test]
fn state_reports_each_state() {
    let home = board();
    add(home.path(), "a");
    run(home.path(), &["mv", "1", "doing"]);
    assert_eq!(
        run(home.path(), &["state", "1", "running"]).out,
        "#1 is now running.\n"
    );
    assert_eq!(
        run(home.path(), &["state", "1", "running"]).out,
        "#1 is already running.\n"
    );
    assert_eq!(
        run(
            home.path(),
            &["state", "1", "pending", "--reason", "Waiting for review"]
        )
        .out,
        "#1 is now pending: Waiting for review\n"
    );
    assert_eq!(
        run(
            home.path(),
            &["state", "1", "pending", "--reason", "Waiting for review"]
        )
        .out,
        "#1 is already pending: Waiting for review\n"
    );
    assert_eq!(
        run(
            home.path(),
            &["state", "1", "pending", "--reason", "Something else"]
        )
        .out,
        "#1 is now pending: Something else\n"
    );
    assert_eq!(
        run(home.path(), &["state", "1", "pending"]).out,
        "#1 is now pending.\n"
    );
    assert_eq!(
        run(home.path(), &["state", "1", "idle"]).out,
        "#1 is now idle.\n"
    );
    assert_eq!(
        run(home.path(), &["state", "1", "idle"]).out,
        "#1 is already idle.\n"
    );
}

#[test]
fn state_outside_doing_is_an_invalid_state_for_column() {
    let home = board();
    add(home.path(), "a");
    for (id_state, column) in [("running", "Todo"), ("pending", "Todo")] {
        let o = run(home.path(), &["state", "1", id_state]);
        assert_eq!(o.code, 1);
        assert_eq!(o.out, "");
        assert_eq!(
            o.err,
            format!(
                "Error: cannot set #1 to {id_state}.\n\
                 Reason: Only cards in Doing can be running or pending. #1 is in {column}.\n"
            )
        );
    }
    let o = run(home.path(), &["state", "1", "running", "--json"]);
    assert_eq!(o.code, 1);
    assert_eq!(
        o.err,
        "{\"error\":{\"code\":\"invalid_state_for_column\",\"message\":\"cannot set #1 to running.\",\
         \"reason\":\"Only cards in Doing can be running or pending. #1 is in Todo.\"}}\n"
    );
    run(home.path(), &["mv", "1", "done"]);
    let o = run(home.path(), &["state", "1", "running"]);
    assert!(o.err.contains("#1 is in Done."), "{}", o.err);
    // idle is always allowed
    assert_eq!(
        run(home.path(), &["state", "1", "idle"]).out,
        "#1 is already idle.\n"
    );
}

#[test]
fn state_reason_is_only_for_pending() {
    let home = board();
    add(home.path(), "a");
    run(home.path(), &["mv", "1", "doing"]);
    for state in ["idle", "running"] {
        let o = run(home.path(), &["state", "1", state, "--reason", "why"]);
        assert_eq!(o.code, 2, "{state}");
        assert_eq!(
            o.err,
            "Error: --reason can only be used with pending.\n\
             Reason: A reason explains what a pending card is waiting for.\n"
        );
    }
    let j = run(
        home.path(),
        &["state", "1", "idle", "--reason", "why", "--json"],
    );
    assert_eq!(j.code, 2);
    assert_eq!(json(&j.err)["error"]["code"], "reason_requires_pending");
}

#[test]
fn state_validates_the_reason_text() {
    let home = board();
    add(home.path(), "a");
    run(home.path(), &["mv", "1", "doing"]);
    let long = "r".repeat(101);
    let o = run(home.path(), &["state", "1", "pending", "--reason", &long]);
    assert_eq!(o.code, 2);
    assert_eq!(
        o.err,
        "Error: reason is invalid.\nReason: Reasons must be 1 to 100 characters on one line.\n"
    );
    let v = json(&run(home.path(), &["show", "1", "--json"]).out);
    assert_eq!(v["card"]["run_state"], "idle");
}

#[test]
fn state_json_is_the_card() {
    let home = board();
    add(home.path(), "a");
    run(home.path(), &["mv", "1", "doing"]);
    let v = json(
        &run(
            home.path(),
            &["state", "1", "pending", "--reason", "r", "--json"],
        )
        .out,
    );
    assert_eq!(v["card"]["run_state"], "pending");
    assert_eq!(v["card"]["pending_reason"], "r");
}

// ------------------------------------------------------------- not found

#[test]
fn unknown_ids_exit_3() {
    let home = board();
    for args in [
        vec!["show", "99"],
        vec!["edit", "99", "--title", "x"],
        vec!["mv", "99", "doing"],
        vec!["state", "99", "idle"],
        vec!["show", "0"],
    ] {
        let o = run(home.path(), &args);
        let id = args[1];
        assert_eq!(o.code, 3, "{args:?}");
        assert_eq!(o.out, "");
        assert_eq!(
            o.err,
            format!(
                "Error: card #{id} not found.\nReason: No card has ID {id}. Run \"skan ls\" to see the cards.\n"
            )
        );
    }
    let j = run(home.path(), &["show", "99", "--json"]);
    assert_eq!(
        j.err,
        "{\"error\":{\"code\":\"card_not_found\",\"message\":\"card #99 not found.\",\
         \"reason\":\"No card has ID 99. Run \\\"skan ls\\\" to see the cards.\"}}\n"
    );
}

// ----------------------------------------------------- after_commit calls

#[test]
fn after_commit_runs_once_per_command_that_changed_the_board() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("board.db");
    let t = "2026-10-02T01:00:00Z";
    let cases: Vec<(Vec<&str>, i32, usize)> = vec![
        (vec!["init", "--name", "demo"], 0, 1),
        (vec!["add", "a"], 0, 1),
        (vec!["add", "b", "--desc", "d"], 0, 1),
        (vec!["edit", "1", "--title", "A"], 0, 1),
        (vec!["edit", "1", "--title", "A"], 0, 0),
        (vec!["mv", "1", "doing"], 0, 1),
        (vec!["mv", "1", "doing"], 0, 0),
        (vec!["state", "1", "running"], 0, 1),
        (vec!["state", "1", "running"], 0, 0),
        (vec!["ls"], 0, 0),
        (vec!["show", "1"], 0, 0),
        (vec!["ls", "--json"], 0, 0),
        // failures never commit
        (vec!["mv", "9", "doing"], 3, 0),
        (vec!["state", "2", "running"], 1, 0),
        (vec!["state", "1", "idle", "--reason", "x"], 2, 0),
        (vec!["add", ""], 2, 0),
        (vec!["add"], 2, 0),
        (vec!["--help"], 0, 0),
        (vec!["rm", "1"], 1, 0),
        (vec!["export"], 1, 0),
        (vec!["init", "--name", "again"], 1, 0),
        (vec!["serve"], 1, 0),
    ];
    for (args, code, commits) in cases {
        let o = run_at(&db, t, &args);
        assert_eq!(o.code, code, "{args:?}: {}", o.err);
        assert_eq!(o.commits, commits, "{args:?}");
    }
}

#[test]
fn after_commit_is_not_called_when_there_is_no_board() {
    let dir = tempfile::tempdir().unwrap();
    let o = run_at(
        &dir.path().join("board.db"),
        "2026-10-02T01:00:00Z",
        &["add", "x"],
    );
    assert_eq!((o.code, o.commits), (4, 0));
}
