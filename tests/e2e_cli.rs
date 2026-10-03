//! End-to-end scenarios for the `skan` binary, run the way an agent or a person
//! would run it.
//!
//! Every test uses the built binary with `SKAN_HOME` in a temporary directory
//! and `TZ=UTC`, and never touches the real data directory. No `skan serve`
//! runs here, so the automatic notification has nothing to reach and must not
//! change any result. Pseudo-terminal runs (Unix only) are at the end.

use std::path::Path;
use std::process::{Command as StdCommand, Stdio};

use assert_cmd::Command;
use serde_json::Value;

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

/// Run with an empty piped standard input, so the run has no terminal.
fn run(home: &Path, args: &[&str]) -> Output {
    let output = skan(home).args(args).write_stdin("").output().unwrap();
    Output {
        code: output.status.code().unwrap(),
        out: String::from_utf8(output.stdout).unwrap(),
        err: String::from_utf8(output.stderr).unwrap(),
    }
}

fn run_ok(home: &Path, args: &[&str]) -> Output {
    let o = run(home, args);
    assert_eq!(o.code, 0, "skan {args:?} failed: {}", o.err);
    assert_eq!(o.err, "", "skan {args:?} wrote to standard error");
    o
}

fn json(text: &str) -> Value {
    serde_json::from_str(text.trim_end()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

fn init(home: &Path, name: &str) {
    let o = run_ok(home, &["init", "--name", name]);
    assert_eq!(o.out, format!("Created board \"{name}\".\n"));
}

/// The cards from `ls --json`, in the order printed.
fn cards(home: &Path) -> Vec<Value> {
    let o = run_ok(home, &["ls", "--json"]);
    json(&o.out)["cards"].as_array().unwrap().clone()
}

fn ids(cards: &[Value]) -> Vec<i64> {
    cards.iter().map(|c| c["id"].as_i64().unwrap()).collect()
}

/// `ls --json` plus every card's `show --json`: everything a reader can see.
fn snapshot(home: &Path) -> Vec<Value> {
    let list = run_ok(home, &["ls", "--json"]);
    let list = json(&list.out);
    let mut all = vec![list.clone()];
    for card in list["cards"].as_array().unwrap() {
        let id = card["id"].to_string();
        all.push(json(&run_ok(home, &["show", &id, "--json"]).out));
    }
    all
}

/// The failure is exactly one JSON line on standard error, with nothing on
/// standard output, and carries the expected code.
fn assert_json_error(o: &Output, exit_code: i32, code: &str) -> Value {
    assert_eq!(o.code, exit_code, "stderr: {}", o.err);
    assert_eq!(o.out, "", "a failing --json run prints nothing on stdout");
    assert!(o.err.ends_with('\n'), "{:?}", o.err);
    assert_eq!(o.err.trim_end().lines().count(), 1, "{:?}", o.err);
    let value = json(&o.err);
    let error = &value["error"];
    assert_eq!(error["code"], code, "{value}");
    for field in ["message", "reason"] {
        assert!(
            error[field].as_str().is_some_and(|s| !s.is_empty()),
            "{field} missing in {value}"
        );
    }
    error.clone()
}

// ------------------------------------------------- an agent's session

#[test]
fn an_agent_works_through_the_board() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();

    init(h, "demo");
    for (n, title) in ["Write the guide", "Review the guide", "Publish the guide"]
        .iter()
        .enumerate()
    {
        let o = run_ok(h, &["add", title]);
        assert_eq!(o.out, format!("Added #{} to Todo: {title}\n", n + 1));
    }

    let o = run_ok(h, &["mv", "1", "doing"]);
    assert_eq!(o.out, "Moved #1 to Doing.\n");
    let o = run_ok(h, &["state", "1", "running"]);
    assert_eq!(o.out, "#1 is now running.\n");

    // #2 is still in Todo, so it cannot be pending.
    let o = run(h, &["state", "2", "pending"]);
    assert_eq!(o.code, 1);
    assert_eq!(o.out, "");
    assert_eq!(
        o.err,
        "Error: cannot set #2 to pending.\n\
         Reason: Only cards in Doing can be running or pending. #2 is in Todo.\n"
    );
    let o = run(h, &["--json", "state", "2", "pending"]);
    let error = assert_json_error(&o, 1, "invalid_state_for_column");
    assert_eq!(error["message"], "cannot set #2 to pending.");
    assert_eq!(
        error["reason"],
        "Only cards in Doing can be running or pending. #2 is in Todo."
    );

    run_ok(h, &["mv", "2", "doing"]);
    let o = run_ok(
        h,
        &["state", "2", "pending", "--reason", "Waiting for review"],
    );
    assert_eq!(o.out, "#2 is now pending: Waiting for review\n");

    // Leaving Doing resets the run state.
    let o = run_ok(h, &["mv", "1", "done"]);
    assert_eq!(o.out, "Moved #1 to Done.\n#1 is now idle.\n");

    let list = cards(h);
    assert_eq!(ids(&list), vec![3, 2, 1], "Todo, then Doing, then Done");
    let shape: Vec<(&str, &str, &str)> = list
        .iter()
        .map(|c| {
            (
                c["column"].as_str().unwrap(),
                c["run_state"].as_str().unwrap(),
                c["title"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        shape,
        vec![
            ("todo", "idle", "Publish the guide"),
            ("doing", "pending", "Review the guide"),
            ("done", "idle", "Write the guide"),
        ]
    );
    assert_eq!(list[1]["pending_reason"], "Waiting for review");
    assert_eq!(list[2]["pending_reason"], Value::Null);

    let o = run_ok(h, &["ls"]);
    assert_eq!(
        o.out,
        "Todo (1)\n  #3  Publish the guide\n\
         Doing (1)\n  #2  Review the guide   pending: Waiting for review\n\
         Done (1)\n  #1  Write the guide\n"
    );

    let o = run_ok(h, &["show", "1"]);
    let lines: Vec<&str> = o.out.lines().collect();
    assert_eq!(lines[0], "#1  Write the guide");
    assert_eq!(lines[1], "Column:   Done");
    assert_eq!(lines[2], "State:    idle");
    let history_at = lines.iter().position(|l| *l == "History").unwrap();
    let history = &lines[history_at + 1..];
    assert_eq!(history.len(), 3, "{history:?}");
    for (line, text) in history
        .iter()
        .zip(["Created -> Todo", "Todo -> Doing", "Doing -> Done"])
    {
        let rest = line.strip_prefix("  ").unwrap().strip_prefix(text).unwrap();
        let stamp = rest.trim_start();
        let bytes = stamp.as_bytes();
        assert!(
            stamp.len() == 11 && bytes[2] == b'/' && bytes[5] == b' ' && bytes[8] == b':',
            "expected MM/DD HH:mm in {line:?}"
        );
    }
    let show = json(&run_ok(h, &["show", "1", "--json"]).out);
    let pairs: Vec<(Value, &str)> = show["card"]["transitions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| (t["from"].clone(), t["to"].as_str().unwrap()))
        .collect();
    assert_eq!(
        pairs,
        vec![
            (Value::Null, "todo"),
            (Value::String("todo".into()), "doing"),
            (Value::String("doing".into()), "done"),
        ]
    );
}

// ------------------------------------------------------- the errors

#[test]
fn every_command_but_the_setup_ones_fails_before_init() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    let commands: &[&[&str]] = &[
        &["add", "A"],
        &["edit", "1", "--title", "B"],
        &["mv", "1", "doing"],
        &["state", "1", "idle"],
        &["rm", "1"],
        &["ls"],
        &["show", "1"],
        &["export"],
        &["serve", "--port", "7639"],
    ];
    for args in commands {
        let o = run(h, args);
        assert_eq!(o.code, 4, "{args:?}: {}", o.err);
        assert_eq!(o.out, "", "{args:?}");
        assert_eq!(
            o.err,
            "Error: no board found.\n\
             Reason: Run \"skan init --name <name>\" to create one, or \"skan import\" to restore one.\n",
            "{args:?}"
        );
        let mut with_json = vec!["--json"];
        with_json.extend_from_slice(args);
        let error = assert_json_error(&run(h, &with_json), 4, "not_initialized");
        assert_eq!(error["message"], "no board found.");
    }
    // The setup commands and the help text work without a board.
    assert_eq!(run(h, &["--help"]).code, 0);
    assert_eq!(run(h, &["--version"]).code, 0);
}

#[test]
fn errors_carry_their_code_exit_status_message_and_reason() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    init(h, "demo");
    run_ok(h, &["add", "Only card", "--desc", "Keep me"]);
    let before = snapshot(h);

    let long_title = "t".repeat(101);
    let long_desc = "d".repeat(301);
    let long_reason = "r".repeat(101);
    let long_name = "n".repeat(51);

    // (arguments, exit code, error code, message, reason)
    type Case<'a> = (Vec<&'a str>, i32, &'static str, String, String);
    let cases: Vec<Case<'_>> = vec![
        (
            vec!["show", "99"],
            3,
            "card_not_found",
            "card #99 not found.".into(),
            "No card has ID 99. Run \"skan ls\" to see the cards.".into(),
        ),
        (
            vec!["mv", "99", "doing"],
            3,
            "card_not_found",
            "card #99 not found.".into(),
            "No card has ID 99. Run \"skan ls\" to see the cards.".into(),
        ),
        (
            vec!["state", "1", "running"],
            1,
            "invalid_state_for_column",
            "cannot set #1 to running.".into(),
            "Only cards in Doing can be running or pending. #1 is in Todo.".into(),
        ),
        (
            vec!["state", "1", "idle", "--reason", "Waiting"],
            2,
            "reason_requires_pending",
            "--reason can only be used with pending.".into(),
            "A reason explains what a pending card is waiting for.".into(),
        ),
        (
            vec!["add", ""],
            2,
            "invalid_value",
            "title is invalid.".into(),
            "Titles must be 1 to 100 characters on one line.".into(),
        ),
        (
            vec!["add", &long_title],
            2,
            "invalid_value",
            "title is invalid.".into(),
            "Titles must be 1 to 100 characters on one line.".into(),
        ),
        (
            vec!["add", "Fine", "--desc", &long_desc],
            2,
            "invalid_value",
            "description is invalid.".into(),
            "Descriptions must be 300 characters or fewer. This one has 301.".into(),
        ),
        (
            vec!["init", "--name", &long_name],
            2,
            "invalid_value",
            "name is invalid.".into(),
            String::new(), // the reason wording is checked for presence only
        ),
        (
            vec!["ls", "--bogus"],
            2,
            "invalid_argument",
            "unexpected argument '--bogus' found".into(),
            "Run \"skan ls --help\" for usage.".into(),
        ),
        (
            vec!["mv", "1", "nowhere"],
            2,
            "invalid_argument",
            "invalid value 'nowhere' for '<COLUMN>' [possible values: todo, doing, done]".into(),
            "Run \"skan mv --help\" for usage.".into(),
        ),
        (
            vec!["frobnicate"],
            2,
            "invalid_argument",
            "unrecognized subcommand 'frobnicate'".into(),
            "Run \"skan --help\" for usage.".into(),
        ),
        (
            vec!["edit", "1"],
            2,
            "invalid_argument",
            "nothing to change; give --title, --desc, or --desc-file.".into(),
            "Run \"skan edit --help\" for usage.".into(),
        ),
    ];

    for (args, exit_code, code, message, reason) in &cases {
        let human = run(h, args);
        assert_eq!(human.code, *exit_code, "{args:?}: {}", human.err);
        assert_eq!(human.out, "", "{args:?}");
        assert!(
            human
                .err
                .starts_with(&format!("Error: {message}\nReason: ")),
            "{args:?}: {:?}",
            human.err
        );
        assert_eq!(human.err.lines().count(), 2, "{args:?}: {:?}", human.err);
        if !reason.is_empty() {
            assert_eq!(
                human.err,
                format!("Error: {message}\nReason: {reason}\n"),
                "{args:?}"
            );
        }

        let mut with_json = vec!["--json"];
        with_json.extend(args.iter().copied());
        let error = assert_json_error(&run(h, &with_json), *exit_code, code);
        assert_eq!(error["message"], message.as_str(), "{args:?}");
        if !reason.is_empty() {
            assert_eq!(error["reason"], reason.as_str(), "{args:?}");
        }

        // `--json` may also follow the subcommand.
        let mut trailing: Vec<&str> = args.to_vec();
        trailing.push("--json");
        assert_json_error(&run(h, &trailing), *exit_code, code);
    }

    // Nothing above changed the board.
    assert_eq!(snapshot(h), before);

    // A reason over 100 characters is invalid too, and the card stays put.
    run_ok(h, &["mv", "1", "doing"]);
    let before_reason = snapshot(h);
    let o = run(
        h,
        &["--json", "state", "1", "pending", "--reason", &long_reason],
    );
    assert_json_error(&o, 2, "invalid_value");
    assert_eq!(snapshot(h), before_reason);
}

#[test]
fn failed_commands_leave_the_board_unchanged() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    init(h, "demo");
    run_ok(h, &["add", "One"]);
    run_ok(h, &["add", "Two", "--desc", "Second"]);
    let before = snapshot(h);

    let failing: &[&[&str]] = &[
        &["state", "1", "running"],
        &["state", "1", "pending", "--reason", "x"],
        &["mv", "9", "done"],
        &["edit", "1", "--title", ""],
        &["add", ""],
        &["rm", "1"],
        &["init", "--name", "other"],
        &["state", "1", "idle", "--reason", "x"],
    ];
    for args in failing {
        let o = run(h, args);
        assert_ne!(o.code, 0, "{args:?} should fail");
        assert_eq!(snapshot(h), before, "{args:?} changed the board");
    }
}

// --------------------------------------------- export and import

#[test]
fn a_board_survives_export_and_import_into_another_data_directory() {
    let source = tempfile::tempdir().unwrap();
    let s = source.path();
    init(s, "round trip");
    run_ok(s, &["add", "First", "--desc", "line one\nline two"]);
    run_ok(s, &["add", "Second"]);
    run_ok(s, &["add", "Third", "--desc", "日本語の説明"]);
    run_ok(s, &["mv", "1", "doing"]);
    run_ok(s, &["state", "1", "running"]);
    run_ok(s, &["mv", "2", "doing"]);
    run_ok(
        s,
        &["state", "2", "pending", "--reason", "Waiting for review"],
    );
    run_ok(s, &["mv", "3", "doing"]);
    run_ok(s, &["mv", "3", "done"]);
    run_ok(s, &["mv", "3", "todo"]);
    run_ok(s, &["add", "Fourth"]);
    run_ok(s, &["mv", "4", "done"]);

    let o = run_ok(s, &["export", "-o", "board.json"]);
    assert_eq!(o.out, "Exported 4 cards to ./board.json.\n");
    let first = std::fs::read(s.join("board.json")).unwrap();
    assert!(first.ends_with(b"\n") && !first.ends_with(b"\n\n"));

    // The same state exports to the same bytes.
    run_ok(s, &["export", "-o", "again.json"]);
    assert_eq!(std::fs::read(s.join("again.json")).unwrap(), first);

    // A fresh data directory restores the board from the file alone.
    let target = tempfile::tempdir().unwrap();
    let t = target.path();
    let file = s.join("board.json");
    let o = run_ok(t, &["import", file.to_str().unwrap()]);
    assert_eq!(
        o.out,
        format!(
            "Imported board \"round trip\" with 4 cards from {}.\n",
            file.display()
        )
    );
    assert_eq!(snapshot(t), snapshot(s));
    assert_eq!(cards(t).len(), 4);

    // The restored board exports the same bytes, and the next ID continues.
    run_ok(t, &["export", "-o", "restored.json"]);
    assert_eq!(std::fs::read(t.join("restored.json")).unwrap(), first);
    let o = run_ok(t, &["add", "Fifth", "--json"]);
    assert_eq!(json(&o.out)["card"]["id"], 5);

    // `export --json` reports an absolute path and the count.
    let o = run_ok(s, &["export", "--json"]);
    let report = json(&o.out);
    assert_eq!(report["cards"], 4);
    assert!(Path::new(report["path"].as_str().unwrap()).is_absolute());
    assert!(s.join("skan.json").exists());
}

#[test]
fn an_invalid_file_is_rejected_without_changing_anything() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    let bad = h.join("bad.json");

    // Without a board the import fails and no board appears.
    std::fs::write(&bad, "{\"format\":\"nope\"}").unwrap();
    let o = run(h, &["--json", "import", "bad.json"]);
    let error = assert_json_error(&o, 1, "import_invalid");
    assert_eq!(error["message"], "bad.json is not a valid board file.");
    assert_eq!(run(h, &["ls"]).code, 4);

    // With a board, validation comes before the confirmation.
    init(h, "demo");
    run_ok(h, &["add", "Keep me"]);
    let before = snapshot(h);
    let o = run(h, &["import", "bad.json"]);
    assert_eq!(o.code, 1);
    assert!(
        o.err
            .starts_with("Error: bad.json is not a valid board file.\n"),
        "{:?}",
        o.err
    );
    assert_eq!(snapshot(h), before);

    let o = run(h, &["--json", "import", "missing.json"]);
    assert_json_error(&o, 1, "file_error");
}

// ------------------------------------- confirmations without a terminal

#[test]
fn destructive_commands_need_a_human_when_there_is_no_terminal() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    init(h, "demo");
    run_ok(h, &["add", "One"]);
    run_ok(h, &["add", "Two"]);
    run_ok(h, &["export", "-o", "keep.json"]);
    let before = snapshot(h);

    let reason =
        "Run this command yourself in a terminal. Agents cannot delete cards or replace the board.";
    let cases: &[(&[&str], &str)] = &[
        (
            &["rm", "1"],
            "deleting a card needs confirmation from a human.",
        ),
        (
            &["init", "--name", "other"],
            "replacing the board needs confirmation from a human.",
        ),
        (
            &["import", "keep.json"],
            "replacing the board needs confirmation from a human.",
        ),
    ];
    for (args, message) in cases {
        // Even a "y" on standard input is not an answer: there is no prompt.
        let piped = skan(h).args(*args).write_stdin("y\n").output().unwrap();
        assert_eq!(piped.status.code(), Some(1), "{args:?}");
        assert_eq!(piped.stdout, b"", "{args:?}");
        assert_eq!(
            String::from_utf8(piped.stderr).unwrap(),
            format!("Error: {message}\nReason: {reason}\n"),
            "{args:?}"
        );
        assert_eq!(snapshot(h), before, "{args:?} changed the board");

        let mut with_json = vec!["--json"];
        with_json.extend(args.iter().copied());
        let error = assert_json_error(&run(h, &with_json), 1, "confirmation_required");
        assert_eq!(error["message"], *message);
        assert_eq!(error["reason"], reason);
        assert_eq!(snapshot(h), before, "{args:?} --json changed the board");
    }
}

// ------------------------------------------------ concurrent writers

#[test]
fn eight_simultaneous_adds_all_succeed_with_distinct_ids() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path();
    init(h, "demo");
    let binary = assert_cmd::cargo::cargo_bin("skan");

    let children: Vec<_> = (1..=8)
        .map(|n| {
            StdCommand::new(&binary)
                .args(["add", &format!("Card {n}"), "--json"])
                .env("SKAN_HOME", h)
                .env("TZ", "UTC")
                .current_dir(h)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect();

    let mut assigned = Vec::new();
    for child in children {
        let output = child.wait_with_output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(0),
            "stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let card = json(&String::from_utf8(output.stdout).unwrap())["card"].clone();
        assigned.push(card["id"].as_i64().unwrap());
    }
    assigned.sort_unstable();
    assert_eq!(assigned, (1..=8).collect::<Vec<i64>>());

    let listed = cards(h);
    assert_eq!(listed.len(), 8);
    let mut titles: Vec<&str> = listed
        .iter()
        .map(|c| c["title"].as_str().unwrap())
        .collect();
    titles.sort_unstable();
    assert_eq!(
        titles,
        (1..=8).map(|n| format!("Card {n}")).collect::<Vec<_>>()
    );
    let mut positions: Vec<i64> = listed
        .iter()
        .map(|c| c["position"].as_i64().unwrap())
        .collect();
    positions.sort_unstable();
    assert_eq!(
        positions,
        (1..=8).collect::<Vec<i64>>(),
        "positions are unique"
    );
}

// ------------------------------------------------------------- help

#[test]
fn help_lists_the_rules_for_agents() {
    let home = tempfile::tempdir().unwrap();
    let o = run_ok(home.path(), &["--help"]);
    let rules = "Rules for agents:\n\
         \x20 - Move a card to doing before you report running or pending.\n\
         \x20 - Report pending with --reason when you are waiting for something.\n\
         \x20 - Moving a card to todo or done resets it to idle.\n\
         \x20 - You cannot delete cards or replace the board. Ask a human to do it.\n\
         \x20 - Add --json to any command for machine-readable output.\n";
    assert!(o.out.contains(rules), "{}", o.out);
    assert!(
        o.out
            .starts_with("skan - a local kanban board for coding agents\n")
    );
    for command in [
        "init", "add", "edit", "mv", "state", "rm", "ls", "show", "export", "import", "serve",
    ] {
        assert!(
            o.out.lines().any(|l| l.trim_start().starts_with(command)),
            "{command} missing from --help"
        );
    }
}

// ------------------------------------------------ pseudo-terminal runs

#[cfg(unix)]
mod terminal {
    use std::path::Path;
    use std::process::Command as StdCommand;
    use std::time::{Duration, Instant};

    use expectrl::process::unix::WaitStatus;
    use expectrl::session::OsSession as Session;
    use expectrl::{Eof, Expect};

    use super::{cards, ids, init, json, run_ok, skan};

    const TIMEOUT: Duration = Duration::from_secs(20);

    /// Start `skan <args>` with the pseudo-terminal as standard input, output
    /// and error. A child that outlives the test is killed when the session
    /// is dropped.
    fn spawn(home: &Path, args: &[&str]) -> Session {
        let program = skan(home).get_program().to_owned();
        let mut command = StdCommand::new(program);
        command
            .args(args)
            .env("SKAN_HOME", home)
            .env("TZ", "UTC")
            .current_dir(home);
        let mut session = Session::spawn(command).expect("spawn skan on a terminal");
        session.set_expect_timeout(Some(TIMEOUT));
        session
    }

    /// Read to the end of the output, reap the child and return its exit code.
    fn finish(mut session: Session) -> i32 {
        session.expect(Eof).expect("the command ends");
        let started = Instant::now();
        loop {
            match session.get_process().status().expect("wait status") {
                WaitStatus::Exited(_, code) => return code,
                WaitStatus::StillAlive => {
                    assert!(started.elapsed() < TIMEOUT, "the command did not exit");
                    std::thread::sleep(Duration::from_millis(20));
                }
                other => panic!("the command did not exit normally: {other:?}"),
            }
        }
    }

    fn expect_text(session: &mut Session, text: &str) {
        session
            .expect(text)
            .unwrap_or_else(|e| panic!("waiting for {text:?}: {e}"));
    }

    fn board_with_cards() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        init(home.path(), "demo");
        for title in ["First", "Second", "Third"] {
            run_ok(home.path(), &["add", title]);
        }
        home
    }

    #[test]
    fn rm_deletes_the_card_after_y() {
        let home = board_with_cards();
        let mut session = spawn(home.path(), &["rm", "2"]);
        expect_text(
            &mut session,
            "Delete #2 \"Second\"? This cannot be undone. [y/N] ",
        );
        session.send_line("y").unwrap();
        expect_text(&mut session, "Deleted #2.");
        assert_eq!(finish(session), 0);
        assert_eq!(ids(&cards(home.path())), vec![1, 3]);

        // IDs are not reused.
        let o = run_ok(home.path(), &["add", "Fourth", "--json"]);
        assert_eq!(json(&o.out)["card"]["id"], 4);
    }

    #[test]
    fn rm_keeps_the_card_after_n_or_an_empty_answer() {
        for answer in ["n", ""] {
            let home = board_with_cards();
            let mut session = spawn(home.path(), &["rm", "2"]);
            expect_text(
                &mut session,
                "Delete #2 \"Second\"? This cannot be undone. [y/N] ",
            );
            session.send_line(answer).unwrap();
            expect_text(&mut session, "Cancelled. Nothing was changed.");
            assert_eq!(finish(session), 0, "{answer:?}");
            assert_eq!(ids(&cards(home.path())), vec![1, 2, 3], "{answer:?}");
        }
    }

    #[test]
    fn init_over_a_board_replaces_it_after_y() {
        let home = board_with_cards();
        let mut session = spawn(home.path(), &["init", "--name", "fresh"]);
        expect_text(
            &mut session,
            "A board \"demo\" already exists. Replace it with an empty board \"fresh\"? \
             All cards and history will be deleted. [y/N] ",
        );
        session.send_line("y").unwrap();
        expect_text(
            &mut session,
            "Replaced the board with an empty board \"fresh\".",
        );
        assert_eq!(finish(session), 0);

        assert!(cards(home.path()).is_empty());
        let o = run_ok(home.path(), &["add", "Again", "--json"]);
        assert_eq!(json(&o.out)["card"]["id"], 1, "the numbering starts over");
    }
}
