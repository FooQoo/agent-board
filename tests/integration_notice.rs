//! Focused tests for the quiet update notice: shown once on a terminal after
//! an ordinary command, and absent for JSON, pipes, hook, wait, serve, help,
//! version, connect, and update. A broken registry never changes a command's
//! output or exit code. Every case uses temporary AGBOARD_HOME, CODEX_HOME,
//! CLAUDE_CONFIG_DIR, and HOME; serve uses a port from 9070 to 9079.

#![cfg(unix)]

mod update_fixture;

use std::fs;
use std::net::TcpListener;

use expectrl::{ControlCode, Expect};
use update_fixture::{Fx, finish, world};

const NOTICE: &str = "is newer than the installed Skill and Hook";

/// A project with a connected, then aged, installation.
fn stale_fx() -> Fx {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age_version_only("0.0.1");
    fx
}

fn count(text: &str) -> usize {
    text.matches(NOTICE).count()
}

fn run_on_terminal(fx: &Fx, args: &[&str]) -> (i32, String) {
    finish(fx.session(&fx.root(), args))
}

#[test]
fn an_ordinary_command_on_a_terminal_shows_the_notice_once() {
    let fx = stale_fx();
    let before = world(&fx.base());
    let (code, screen) = run_on_terminal(&fx, &["project", "ls"]);
    assert_eq!(code, 0, "{screen}");
    assert_eq!(count(&screen), 1, "{screen}");
    assert!(screen.contains("agboard update"), "{screen}");
    assert!(screen.contains("0.0.1"), "{screen}");
    // The command's own output is still there, and the notice is last.
    assert!(screen.contains("Demo"), "{screen}");
    assert!(screen.trim_end().ends_with("to update them."), "{screen}");
    // Showing it wrote nothing.
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn a_current_install_shows_no_notice() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    let (code, screen) = run_on_terminal(&fx, &["project", "ls"]);
    assert_eq!(code, 0, "{screen}");
    assert_eq!(count(&screen), 0, "{screen}");
}

#[test]
fn json_output_and_pipes_never_carry_the_notice() {
    let fx = stale_fx();
    // JSON on a terminal.
    let (code, screen) = run_on_terminal(&fx, &["project", "ls", "--json"]);
    assert_eq!(code, 0, "{screen}");
    assert_eq!(count(&screen), 0, "{screen}");
    // Human output on pipes: stdout and stderr are clean.
    let (code, stdout, stderr) = fx.agboard(&["project", "ls"], &fx.root());
    assert_eq!(code, 0);
    assert_eq!(count(&stdout) + count(&stderr), 0, "{stdout}{stderr}");
    assert!(stderr.is_empty(), "{stderr}");
    // Only standard error is a terminal: stdout stays unpolluted anyway, and
    // with stdout piped the command is not interactive.
    let (code, stdout, stderr) = fx.agboard(&["project", "ls", "--json"], &fx.root());
    assert_eq!(code, 0);
    assert!(
        serde_json::from_str::<serde_json::Value>(&stdout).is_ok(),
        "{stdout}"
    );
    assert!(stderr.is_empty(), "{stderr}");
}

#[test]
fn hook_wait_help_version_connect_and_update_stay_quiet() {
    let fx = stale_fx();
    // Hook: reads its input until the end.
    let mut term = fx.session(&fx.root(), &["hook", "--agent", "claude"]);
    term.send(ControlCode::EndOfTransmission).unwrap();
    let (_, screen) = finish(term);
    assert_eq!(count(&screen), 0, "hook: {screen}");

    // Wait: a short wait on the real cursor.
    let (code, snapshot, stderr) =
        fx.agboard(&["--project", "Demo", "snapshot", "--json"], &fx.root());
    assert_eq!(code, 0, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
    let cursor = value["cursor"].as_str().unwrap().to_string();
    let (_, screen) = run_on_terminal(
        &fx,
        &[
            "--project",
            "Demo",
            "wait",
            "--after",
            &cursor,
            "--timeout",
            "1",
        ],
    );
    assert_eq!(count(&screen), 0, "wait: {screen}");

    for args in [vec!["--help"], vec!["--version"], vec!["help"]] {
        let (_, screen) = run_on_terminal(&fx, &args);
        assert_eq!(count(&screen), 0, "{args:?}: {screen}");
    }

    // Connect from an unbound folder ends at once.
    let (code, screen) = finish(fx.session(&fx.base().join("home"), &["connect"]));
    assert_eq!(code, 1, "{screen}");
    assert_eq!(count(&screen), 0, "connect: {screen}");

    // Update on a terminal: it asks, and prints its own result, not the notice.
    let mut term = fx.session(&fx.root(), &["update"]);
    term.expect("[y/N]").unwrap();
    term.send_line("y").unwrap();
    let (code, screen) = finish(term);
    assert_eq!(code, 0, "{screen}");
    assert_eq!(count(&screen), 0, "update: {screen}");
}

#[test]
fn serve_stays_quiet_and_releases_its_port() {
    let fx = stale_fx();
    let mut term = fx.session(&fx.root(), &["serve", "--port", "9071"]);
    let seen = term.expect("Serving at").unwrap();
    assert_eq!(count(&String::from_utf8_lossy(seen.as_bytes())), 0);
    // The signal handler is installed just after the line is printed.
    std::thread::sleep(std::time::Duration::from_secs(1));
    term.send(ControlCode::EndOfText).unwrap();
    let (_, screen) = finish(term);
    assert_eq!(count(&screen), 0, "serve: {screen}");
    assert!(
        TcpListener::bind("127.0.0.1:9071").is_ok(),
        "port 9071 is still held"
    );
}

#[test]
fn a_failing_command_keeps_its_error_and_exit_code_without_the_notice() {
    let fx = stale_fx();
    let (code, screen) = run_on_terminal(&fx, &["--project", "Nope", "ls"]);
    assert_eq!(code, 4, "{screen}");
    assert_eq!(count(&screen), 0, "{screen}");
}

#[test]
fn an_unreadable_registry_changes_nothing_for_the_command() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    let (_, plain, _) = fx.agboard(&["project", "ls"], &fx.root());
    for text in ["{ not json", "{\"schemaVersion\":9,\"installations\":[]}"] {
        fs::write(fx.registry_file(), text).unwrap();
        let (code, screen) = run_on_terminal(&fx, &["project", "ls"]);
        assert_eq!(code, 0, "{screen}");
        assert_eq!(count(&screen), 0, "{screen}");
        assert!(!screen.to_lowercase().contains("registry"), "{screen}");
        let (code, stdout, stderr) = fx.agboard(&["project", "ls"], &fx.root());
        assert_eq!(
            (code, stdout.as_str(), stderr.as_str()),
            (0, plain.as_str(), "")
        );
        // Update is where the problem is reported.
        let (code, _, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
        assert_eq!(code, 1);
        assert!(stderr.contains("registry"), "{stderr}");
    }
    // A missing registry is simply no notice.
    fs::remove_file(fx.registry_file()).unwrap();
    let (code, screen) = run_on_terminal(&fx, &["project", "ls"]);
    assert_eq!(code, 0);
    assert_eq!(count(&screen), 0, "{screen}");
}

#[test]
fn records_of_a_project_out_of_reach_do_not_trigger_the_notice() {
    let fx = Fx::new();
    fx.connect_both("2", "2");
    fx.age_version_only("0.0.1");
    // From a folder that is not bound to that project.
    let (code, screen) = finish(fx.session(&fx.base().join("home"), &["project", "ls"]));
    assert_eq!(code, 0, "{screen}");
    assert_eq!(count(&screen), 0, "{screen}");
    // From the bound root it is shown.
    let (_, screen) = run_on_terminal(&fx, &["project", "ls"]);
    assert_eq!(count(&screen), 1, "{screen}");
}
