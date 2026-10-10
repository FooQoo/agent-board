//! The command line's project targeting and project management: every board
//! command names its project, projects can be created, listed, renamed and
//! deleted, and nothing destructive happens without a human.

use std::ffi::OsString;
use std::io::{BufRead, Cursor, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use agent_board::cli::{Context, Env, Target};
use agent_board::clock::SystemClock;
use assert_cmd::Command;
use serde_json::{Value, json};
use tempfile::tempdir;

// ---- helpers --------------------------------------------------------------

fn agboard(home: &Path, args: &[&str]) -> assert_cmd::assert::Assert {
    Command::cargo_bin("agboard")
        .unwrap()
        .env("SKAN_HOME", home)
        .env("TZ", "UTC")
        .args(args)
        .assert()
}

fn stdout_json(assert: assert_cmd::assert::Assert) -> Value {
    serde_json::from_slice(&assert.success().get_output().stdout).unwrap()
}

fn stderr_json(assert: assert_cmd::assert::Assert, code: i32) -> Value {
    serde_json::from_slice(&assert.failure().code(code).get_output().stderr).unwrap()
}

fn error_code(assert: assert_cmd::assert::Assert, exit: i32) -> String {
    stderr_json(assert, exit)["error"]["code"]
        .as_str()
        .unwrap()
        .to_string()
}

const CARD: [&str; 5] = ["--assignee", "ai", "--actor", "ai", "--json"];

fn add_card(home: &Path, project: &str, title: &str) -> Value {
    let mut args = vec!["--project", project, "add", title];
    args.extend(CARD);
    stdout_json(agboard(home, &args))
}

/// Everything observable: the catalog and every project's full snapshot
/// (without the fetch time).
fn world(home: &Path) -> Value {
    let catalog = stdout_json(agboard(home, &["project", "ls", "--json"]));
    let mut projects = Vec::new();
    for project in catalog["projects"].as_array().unwrap() {
        let name = project["name"].as_str().unwrap();
        let mut snapshot = stdout_json(agboard(home, &["--project", name, "snapshot", "--json"]));
        snapshot.as_object_mut().unwrap().remove("fetchedAt");
        projects.push(snapshot);
    }
    json!({"catalog": catalog, "projects": projects})
}

fn titles(home: &Path, project: &str) -> Vec<String> {
    stdout_json(agboard(home, &["--project", project, "ls", "--json"]))["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["title"].as_str().unwrap().to_string())
        .collect()
}

fn two_projects(home: &Path) {
    agboard(home, &["project", "create", "A"]).success();
    agboard(home, &["project", "create", "B"]).success();
}

// ---- AC-1, AC-3: create, list, rename, isolation ----------------------------

#[test]
fn two_projects_keep_equal_card_numbers_apart() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let a = add_card(home.path(), "A", "only in A");
    let b = add_card(home.path(), "B", "only in B");
    assert_eq!(a["card"]["id"], 1);
    assert_eq!(b["card"]["id"], 1);

    agboard(
        home.path(),
        &[
            "--project",
            "A",
            "mv",
            "1",
            "doing",
            "--actor",
            "ai",
            "--reason",
            "go",
        ],
    )
    .success();
    agboard(
        home.path(),
        &[
            "--project",
            "A",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "working",
        ],
    )
    .success();

    let shown_a = stdout_json(agboard(
        home.path(),
        &["--project", "A", "show", "1", "--json"],
    ));
    let shown_b = stdout_json(agboard(
        home.path(),
        &["--project", "B", "show", "1", "--json"],
    ));
    assert_eq!(shown_a["card"]["title"], "only in A");
    assert_eq!(shown_a["card"]["cardStatus"], "doing");
    assert_eq!(shown_a["card"]["agentStatus"], "running");
    assert_eq!(shown_b["card"]["title"], "only in B");
    assert_eq!(shown_b["card"]["cardStatus"], "todo");
    assert_eq!(shown_b["card"]["agentStatus"], "idle");
    assert_eq!(shown_b["card"]["history"].as_array().unwrap().len(), 1);

    // A card number that exists in neither project is not found, per project.
    agboard(home.path(), &["--project", "B", "show", "2", "--json"])
        .failure()
        .code(3);
    assert_eq!(titles(home.path(), "A"), ["only in A"]);
    assert_eq!(titles(home.path(), "B"), ["only in B"]);
}

#[test]
fn project_create_prints_the_project_and_ls_lists_by_name_with_the_catalog_version() {
    let home = tempdir().unwrap();
    let created = stdout_json(agboard(
        home.path(),
        &["project", "create", "Zed", "--json"],
    ));
    assert_eq!(created["project"]["name"], "Zed");
    assert!(created["project"]["id"].as_str().unwrap().len() >= 16);
    assert!(created["project"]["createdAt"].is_string());
    agboard(home.path(), &["project", "create", "Alpha one"]).success();
    let out = agboard(home.path(), &["project", "create", "Mid"]).success();
    assert!(
        String::from_utf8_lossy(&out.get_output().stdout).contains("Created project \"Mid\""),
        "human output names the project"
    );

    let raw = agboard(home.path(), &["project", "ls", "--json"])
        .success()
        .get_output()
        .stdout
        .clone();
    let raw = String::from_utf8(raw).unwrap();
    let list: Value = serde_json::from_str(&raw).unwrap();
    let names: Vec<_> = list["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Alpha one", "Mid", "Zed"]);
    assert_eq!(list["catalogVersion"].as_str().unwrap().len(), 32);
    // Documented key order: projects (id, name, createdAt), then catalogVersion.
    let pos = |needle: &str| raw.find(needle).unwrap();
    assert!(pos("\"projects\"") < pos("\"catalogVersion\""));
    assert!(pos("\"id\"") < pos("\"name\"") && pos("\"name\"") < pos("\"createdAt\""));

    let human = agboard(home.path(), &["project", "ls"]).success();
    let human = String::from_utf8_lossy(&human.get_output().stdout).to_string();
    assert!(human.contains("Alpha one") && human.contains("Zed"));
}

#[test]
fn creating_or_renaming_to_an_existing_name_is_refused_and_changes_nothing() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    add_card(home.path(), "A", "kept");
    let before = world(home.path());

    for args in [
        vec!["project", "create", "A", "--json"],
        // The name is compared after normalization (surrounding space is dropped).
        vec!["project", "create", "  B  ", "--json"],
        vec!["--project", "A", "project", "rename", "B", "--json"],
    ] {
        assert_eq!(
            error_code(agboard(home.path(), &args), 2),
            "project_name_exists",
            "{args:?}"
        );
    }
    assert_eq!(world(home.path()), before);
}

#[test]
fn renaming_to_the_same_normalized_name_succeeds_without_a_change() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let before = world(home.path());
    let out = agboard(
        home.path(),
        &["--project", "A", "project", "rename", "  A ", "--json"],
    );
    let value = stdout_json(out);
    assert_eq!(value["project"]["name"], "A");
    assert_eq!(world(home.path()), before);
}

// ---- AC-2: the target is explicit -------------------------------------------

#[test]
fn every_project_command_refuses_a_missing_project() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    let before = world(home.path());
    let cursor = "0123456789abcdef0123456789abcdef:1";
    let commands: Vec<Vec<&str>> = vec![
        vec!["init"],
        vec!["add", "x", "--assignee", "ai", "--actor", "ai"],
        vec!["edit", "1", "--title", "x"],
        vec!["mv", "1", "doing", "--actor", "ai", "--reason", "r"],
        vec!["state", "1", "running", "--actor", "ai", "--reason", "r"],
        vec!["rm", "1"],
        vec!["ls"],
        vec!["show", "1"],
        vec!["snapshot", "--json"],
        vec!["wait", "--after", cursor, "--timeout", "1", "--json"],
        vec!["project", "rename", "New"],
        vec!["project", "rm"],
    ];
    for command in commands {
        let mut command = command;
        if !command.contains(&"--json") {
            command.push("--json");
        }
        let output = Command::cargo_bin("agboard")
            .unwrap()
            .env("SKAN_HOME", home.path())
            .current_dir(home.path())
            .args(&command)
            .assert()
            .failure()
            .code(2)
            .get_output()
            .stderr
            .clone();
        if command.first() == Some(&"wait") {
            continue;
        }
        let error: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(error["error"]["code"], "invalid_argument", "{command:?}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .contains("--project"),
            "{command:?}"
        );
    }
    assert_eq!(world(home.path()), before);
}

#[test]
fn an_unknown_project_is_not_found_and_never_replaced_by_another() {
    let home = tempdir().unwrap();
    agboard(home.path(), &["project", "create", "Only"]).success();
    let before = world(home.path());
    for command in [
        vec!["--project", "Nope", "ls", "--json"],
        vec!["--project", "Nope", "show", "1", "--json"],
        vec!["--project", "Nope", "snapshot", "--json"],
        vec!["--project", "Nope", "rm", "1", "--json"],
        vec![
            "--project",
            "Nope",
            "add",
            "x",
            "--assignee",
            "ai",
            "--actor",
            "ai",
            "--json",
        ],
        vec!["--project", "Nope", "project", "rename", "N2", "--json"],
        vec!["--project", "Nope", "project", "rm", "--json"],
        // Even with exactly one project, a different name is not that project.
        vec!["--project", "only", "ls", "--json"],
    ] {
        assert_eq!(
            error_code(agboard(home.path(), &command), 4),
            "project_not_found",
            "{command:?}"
        );
    }
    assert_eq!(world(home.path()), before);
}

#[test]
fn project_option_syntax_before_or_after_the_command_with_spaces_and_duplicates() {
    let home = tempdir().unwrap();
    agboard(home.path(), &["project", "create", "My team board"]).success();
    // Before the subcommand, after it, and after its own arguments.
    for args in [
        vec!["--project", "My team board", "ls", "--json"],
        vec!["ls", "--project", "My team board", "--json"],
        vec!["ls", "--json", "--project", "My team board"],
        vec!["--json", "--project=My team board", "ls"],
    ] {
        let value = stdout_json(agboard(home.path(), &args));
        assert!(value["cards"].is_array(), "{args:?}");
    }
    // The option given twice is rejected, even with the same value.
    for args in [
        vec!["--project", "My team board", "ls", "--project", "other"],
        vec![
            "--project",
            "My team board",
            "--project",
            "My team board",
            "ls",
        ],
    ] {
        assert_eq!(
            error_code(
                agboard(home.path(), &[args.as_slice(), &["--json"]].concat()),
                2
            ),
            "invalid_argument",
            "{args:?}"
        );
    }
    // A project name that is empty or spans lines is an invalid value.
    for bad in ["", "   ", "a\nb"] {
        assert_eq!(
            error_code(agboard(home.path(), &["--project", bad, "ls", "--json"]), 2),
            "invalid_value",
            "{bad:?}"
        );
    }
}

#[test]
fn global_commands_reject_project_and_work_with_no_projects() {
    let home = tempdir().unwrap();
    for args in [
        vec!["--project", "x", "project", "create", "y", "--json"],
        vec!["--project", "x", "project", "ls", "--json"],
        vec!["--project", "x", "serve", "--port", "0", "--json"],
    ] {
        assert_eq!(
            error_code(agboard(home.path(), &args), 2),
            "invalid_argument",
            "{args:?}"
        );
    }
    // project create/ls and --help/--version do not need a project.
    assert!(!home.path().join("board.db").exists());
    agboard(home.path(), &["--help"]).success();
    agboard(home.path(), &["--version"]).success();
    agboard(home.path(), &["--project", "x", "--help"]).success();
    assert!(!home.path().join("board.db").exists());
}

// ---- read-only commands and old data --------------------------------------

// ---- AC-4: deletion needs a human -----------------------------------------

#[test]
fn project_rm_and_card_rm_refuse_without_a_human_terminal() {
    let home = tempdir().unwrap();
    two_projects(home.path());
    add_card(home.path(), "A", "keep me");
    let before = world(home.path());
    for args in [
        vec!["--project", "A", "project", "rm", "--json"],
        vec!["--project", "A", "project", "rm"],
        vec!["--project", "A", "rm", "1", "--json"],
        vec!["--project", "A", "rm", "1"],
    ] {
        // Even a "yes" on standard input is not a human at a terminal.
        let output = Command::cargo_bin("agboard")
            .unwrap()
            .env("SKAN_HOME", home.path())
            .args(&args)
            .write_stdin("y\n")
            .assert()
            .failure()
            .code(1)
            .get_output()
            .stderr
            .clone();
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("confirmation_required") || text.contains("needs confirmation"));
    }
    assert_eq!(world(home.path()), before);
}

#[cfg(unix)]
mod terminal {
    use super::*;
    use expectrl::process::unix::WaitStatus;
    use expectrl::session::OsSession as Session;
    use expectrl::{ControlCode, Eof, Expect};

    fn session(home: &Path, args: &[&str]) -> Session {
        let mut command =
            std::process::Command::new(Command::cargo_bin("agboard").unwrap().get_program());
        command.env("SKAN_HOME", home).env("TZ", "UTC").args(args);
        let mut session = expectrl::Session::spawn(command).unwrap();
        session.set_expect_timeout(Some(Duration::from_secs(20)));
        session
    }

    fn finish(mut session: Session) -> i32 {
        session.expect(Eof).unwrap();
        match session.get_process().wait().unwrap() {
            WaitStatus::Exited(_, code) => code,
            other => panic!("unexpected end: {other:?}"),
        }
    }

    const PROMPT: &str = "Delete project A and all its cards and history? [y/N] ";

    #[test]
    fn project_rm_asks_on_the_terminal_and_only_a_yes_deletes() {
        for (answer, deleted) in [
            (Some("y"), true),
            (Some("yes"), true),
            (Some("YES"), true),
            (Some("n"), false),
            (Some("N"), false),
            (Some(""), false),
            (Some("yep"), false),
            (None, false), // end of input (Ctrl+D)
        ] {
            let home = tempdir().unwrap();
            two_projects(home.path());
            add_card(home.path(), "A", "a1");
            add_card(home.path(), "B", "b1");
            let before = world(home.path());

            let mut term = session(home.path(), &["--project", "A", "project", "rm"]);
            term.expect(PROMPT).unwrap();
            match answer {
                Some(text) => term.send_line(text).unwrap(),
                None => term.send(ControlCode::EndOfTransmission).unwrap(),
            }
            let code = finish(term);
            assert_eq!(code, 0, "{answer:?}");

            let after = world(home.path());
            if deleted {
                assert_ne!(after, before);
                let names: Vec<_> = after["catalog"]["projects"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p["name"].as_str().unwrap().to_string())
                    .collect();
                assert_eq!(names, ["B"], "{answer:?}");
                assert_eq!(after["projects"][0], before["projects"][1]);
            } else {
                assert_eq!(after, before, "{answer:?} must not change anything");
            }
        }
    }

    #[test]
    fn a_cancelled_project_rm_says_so() {
        let home = tempdir().unwrap();
        two_projects(home.path());
        let mut term = session(home.path(), &["--project", "A", "project", "rm"]);
        term.expect(PROMPT).unwrap();
        term.send_line("n").unwrap();
        term.expect("Cancelled. Nothing was changed.").unwrap();
        assert_eq!(finish(term), 0);
    }

    #[test]
    fn json_stays_non_interactive_even_on_a_terminal() {
        let home = tempdir().unwrap();
        two_projects(home.path());
        let before = world(home.path());
        let term = session(home.path(), &["--project", "A", "project", "rm", "--json"]);
        let mut term = term;
        term.expect("confirmation_required").unwrap();
        assert_eq!(finish(term), 1);
        assert_eq!(world(home.path()), before);
    }

    #[test]
    fn deleting_a_project_notifies_a_running_server_once() {
        let home = tempdir().unwrap();
        two_projects(home.path());
        let spy = NotifySpy::start(home.path());
        let mut term = session(home.path(), &["--project", "A", "project", "rm"]);
        term.expect(PROMPT).unwrap();
        term.send_line("y").unwrap();
        assert_eq!(finish(term), 0);
        assert_eq!(spy.stop(), 1);

        // A cancellation does not.
        let spy = NotifySpy::start(home.path());
        let mut term = session(home.path(), &["--project", "B", "project", "rm"]);
        term.expect("[y/N] ").unwrap();
        term.send_line("n").unwrap();
        assert_eq!(finish(term), 0);
        assert_eq!(spy.stop(), 0);
    }
}

// ---- notification of a running serve --------------------------------------

/// A stand-in for `agboard serve`: counts `POST /api/notify` requests and
/// answers 204. `serve.json` in `dir` points the CLI at it.
struct NotifySpy {
    count: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl NotifySpy {
    fn start(dir: &Path) -> NotifySpy {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::fs::write(
            dir.join("serve.json"),
            format!(
                r#"{{"pid":{},"port":{port},"started_at":"2026-10-06T00:00:00Z"}}"#,
                std::process::id()
            ),
        )
        .unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (c, s) = (count.clone(), stop.clone());
        let handle = thread::spawn(move || {
            while !s.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut head = Vec::new();
                        let mut buf = [0u8; 256];
                        while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                            match stream.read(&mut buf) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => head.extend_from_slice(&buf[..n]),
                            }
                        }
                        if head.starts_with(b"POST /api/notify") {
                            c.fetch_add(1, Ordering::SeqCst);
                        }
                        let _ = stream
                            .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                    }
                    Err(_) => thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        NotifySpy {
            count,
            stop,
            handle: Some(handle),
        }
    }

    /// Stop listening and return how many notifications arrived.
    fn stop(mut self) -> usize {
        thread::sleep(Duration::from_millis(100));
        self.stop.store(true, Ordering::SeqCst);
        self.handle.take().unwrap().join().unwrap();
        self.count.load(Ordering::SeqCst)
    }
}

/// Run the CLI in this process with a spy instead of a server notification.
fn in_process(home: &Path, args: &[&str]) -> (i32, String, String, usize, Vec<PathBuf>) {
    let args: Vec<OsString> = std::iter::once("agboard")
        .chain(args.iter().copied())
        .map(OsString::from)
        .collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let mut calls = 0usize;
    let mut dirs = Vec::new();
    let mut spy = |_: &Context, dir: &Path| {
        calls += 1;
        dirs.push(dir.to_path_buf());
    };
    let mut env = Env {
        clock: Box::new(SystemClock),
        shared_dir: home.join("shared"),
        stdout: &mut out,
        stderr: &mut err,
        after_commit: &mut spy,
    };
    let code = agent_board::cli::run_with(&args, &mut env);
    (
        code,
        String::from_utf8(out).unwrap(),
        String::from_utf8(err).unwrap(),
        calls,
        dirs,
    )
}

#[test]
fn only_a_confirmed_real_change_notifies_once_and_to_the_data_directory() {
    let home = tempdir().unwrap();
    let calls = |args: &[&str]| {
        let (code, _, err, calls, dirs) = in_process(home.path(), args);
        for dir in &dirs {
            assert_eq!(
                dir,
                home.path(),
                "the notification targets the data directory"
            );
        }
        (code, err, calls)
    };
    let card = ["--assignee", "ai", "--actor", "ai"];
    let add = |p| [&["--project", p, "add", "x"][..], &card].concat();

    // Real changes: one notification each.
    assert_eq!(calls(&["project", "create", "A"]).2, 1);
    assert_eq!(
        calls(&["--project", "A", "init", "--json"]).2,
        0,
        "init of an existing project needs a human"
    );
    assert_eq!(calls(&["--project", "N", "init"]).2, 1);
    assert_eq!(calls(&add("A")).2, 1);
    assert_eq!(
        calls(&[
            "--project",
            "A",
            "mv",
            "1",
            "doing",
            "--actor",
            "ai",
            "--reason",
            "r"
        ])
        .2,
        1
    );
    assert_eq!(
        calls(&[
            "--project",
            "A",
            "state",
            "1",
            "running",
            "--actor",
            "ai",
            "--reason",
            "r"
        ])
        .2,
        1
    );
    assert_eq!(calls(&["--project", "A", "edit", "1", "--title", "y"]).2, 1);
    assert_eq!(calls(&["--project", "A", "project", "rename", "A2"]).2, 1);

    // No change, failure, refusal and reads: none.
    assert_eq!(
        calls(&["--project", "A2", "project", "rename", "A2"]).2,
        0,
        "same name"
    );
    assert_eq!(
        calls(&[
            "--project",
            "A2",
            "mv",
            "1",
            "doing",
            "--actor",
            "ai",
            "--reason",
            "r"
        ])
        .2,
        0,
        "same column"
    );
    assert_eq!(calls(&["project", "create", "A2"]).2, 0, "duplicate");
    assert_eq!(
        calls(&["--project", "A2", "project", "rename", "N"]).2,
        0,
        "duplicate"
    );
    assert_eq!(
        calls(&["--project", "ghost", "project", "rename", "G"]).2,
        0
    );
    assert_eq!(
        calls(&["--project", "A2", "project", "rm"]).2,
        0,
        "no human"
    );
    assert_eq!(calls(&["--project", "A2", "rm", "1"]).2, 0, "no human");
    assert_eq!(calls(&["project", "ls"]).2, 0);
    assert_eq!(calls(&["--project", "A2", "ls"]).2, 0);
    assert_eq!(calls(&["--project", "A2", "show", "1"]).2, 0);
    assert_eq!(calls(&["--project", "A2", "snapshot", "--json"]).2, 0);
    assert_eq!(calls(&["--project", "A2", "workspace", "--json"]).2, 0);
}

#[test]
fn the_notification_goes_to_the_serve_of_the_same_data_directory_only() {
    use agent_board::interact::notify::notify_serve_in;
    let (mine, elsewhere) = (tempdir().unwrap(), tempdir().unwrap());
    let spy_mine = NotifySpy::start(mine.path());
    let spy_other = NotifySpy::start(elsewhere.path());
    assert!(notify_serve_in(mine.path()));
    assert_eq!(spy_mine.stop(), 1);
    assert_eq!(spy_other.stop(), 0);
    // A directory without serve.json notifies nobody.
    assert!(!notify_serve_in(tempdir().unwrap().path()));
}

#[test]
fn a_real_cli_change_reaches_the_server_of_its_own_data_directory() {
    let home = tempdir().unwrap();
    let spy = NotifySpy::start(home.path());
    agboard(home.path(), &["project", "create", "A"]).success();
    agboard(home.path(), &["project", "create", "A"]).failure();
    agboard(home.path(), &["project", "ls"]).success();
    assert_eq!(spy.stop(), 1);
}

// ---- races during a human's confirmation ------------------------------------

/// A reader that runs `before` when the confirmation first reads its answer,
/// as if the world changed while the human was deciding.
struct SlowAnswer<F: FnMut()> {
    before: Option<F>,
    answer: Cursor<Vec<u8>>,
}

impl<F: FnMut()> SlowAnswer<F> {
    fn new(answer: &str, before: F) -> Self {
        SlowAnswer {
            before: Some(before),
            answer: Cursor::new(answer.as_bytes().to_vec()),
        }
    }
}

impl<F: FnMut()> Read for SlowAnswer<F> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.answer.read(buf)
    }
}

impl<F: FnMut()> BufRead for SlowAnswer<F> {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
        if let Some(mut before) = self.before.take() {
            before();
        }
        self.answer.fill_buf()
    }
    fn consume(&mut self, amount: usize) {
        self.answer.consume(amount)
    }
}

mod races {
    use super::*;
    use agent_board::cli::args::ProjectRenameArgs;
    use agent_board::cli::commands::project;
    use agent_board::domain::{Actor, Assignee, NewCard, ProjectId};
    use agent_board::file_store::FileStore;

    struct World {
        _dir: tempfile::TempDir,
        shared: PathBuf,
        /// The store of the command under test.
        mine: FileStore,
        /// Another process's store on the same shared folder.
        other: FileStore,
    }

    fn world() -> World {
        let dir = tempdir().unwrap();
        let shared = dir.path().join("shared");
        let mine = FileStore::open(&shared);
        let other = FileStore::open(&shared);
        World {
            _dir: dir,
            shared,
            mine,
            other,
        }
    }

    fn put(store: &FileStore, name: &str, card: &str) -> ProjectId {
        let at = chrono::Utc::now();
        let id = store.create_project(name, at).unwrap().id;
        store
            .create_card(
                &id,
                NewCard {
                    title: card.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                },
                at,
            )
            .unwrap();
        id
    }

    fn context(w: &World, name: &str) -> Context {
        let meta = w.mine.project_by_name(name).unwrap();
        Context {
            files: FileStore::open(&w.shared),
            target: Target::Existing(meta),
            clock: Box::new(SystemClock),
            json: false,
            interactive: true,
        }
    }

    fn snapshot_of(store: &FileStore, id: &ProjectId) -> Value {
        serde_json::to_value(store.snapshot(id).unwrap()).unwrap()
    }

    #[test]
    fn project_rm_prompt_names_the_project_and_cancels_cleanly() {
        let w = world();
        let a = put(&w.mine, "A b", "x");
        let b = put(&w.mine, "B", "y");
        let before = (snapshot_of(&w.mine, &a), snapshot_of(&w.mine, &b));
        for no in ["n\n", "\n", "", "yep\n"] {
            let ctx = context(&w, "A b");
            let mut prompt = Vec::new();
            let outcome =
                project::rm_with_io(&ctx, &mut Cursor::new(no.as_bytes().to_vec()), &mut prompt)
                    .unwrap();
            assert!(!outcome.changed);
            assert_eq!(
                String::from_utf8(prompt).unwrap(),
                "Delete project A b and all its cards and history? [y/N] "
            );
            assert_eq!(outcome.human, "Cancelled. Nothing was changed.\n");
            assert_eq!(outcome.json, json!({"cancelled": true}));
        }
        assert_eq!(snapshot_of(&w.mine, &a), before.0);
        assert_eq!(snapshot_of(&w.mine, &b), before.1);
    }

    #[test]
    fn project_rm_without_a_human_refuses() {
        let w = world();
        let a = put(&w.mine, "A", "x");
        let before = snapshot_of(&w.mine, &a);
        for (json, interactive) in [(true, true), (false, false), (true, false)] {
            let mut ctx = context(&w, "A");
            ctx.json = json;
            ctx.interactive = interactive;
            let error =
                project::rm_with_io(&ctx, &mut Cursor::new(b"y\n".to_vec()), &mut Vec::new())
                    .err()
                    .unwrap();
            assert_eq!(error.code(), "confirmation_required");
        }
        assert_eq!(snapshot_of(&w.mine, &a), before);
    }

    #[test]
    fn project_deleted_and_recreated_during_the_prompt_is_not_deleted() {
        let w = world();
        let a = put(&w.mine, "A", "original");
        let ctx = context(&w, "A");
        let mut reborn = None;
        let mut input = SlowAnswer::new("y\n", || {
            w.other.delete_project(&a).unwrap();
            reborn = Some(put(&w.other, "A", "new one"));
        });
        let error = project::rm_with_io(&ctx, &mut input, &mut Vec::new())
            .err()
            .unwrap();
        assert_eq!(error.code(), "project_not_found");
        let reborn = reborn.unwrap();
        assert_ne!(reborn, a);
        let kept = w.mine.snapshot(&reborn).unwrap();
        assert_eq!(kept.cards.len(), 1);
        assert_eq!(kept.cards[0].title, "new one");
    }

    #[test]
    fn rename_follows_the_resolved_id_and_never_another_project() {
        let w = world();
        let a = put(&w.mine, "A", "original");
        let ctx = context(&w, "A"); // resolved here
        w.other.delete_project(&a).unwrap();
        let reborn = put(&w.other, "A", "reborn");
        let before = snapshot_of(&w.other, &reborn);
        let error = project::rename(
            &ctx,
            &ProjectRenameArgs {
                new_name: "Z".into(),
            },
        )
        .err()
        .unwrap();
        assert_eq!(error.code(), "project_not_found");
        assert_eq!(snapshot_of(&w.other, &reborn), before);
        assert_eq!(w.other.snapshot(&reborn).unwrap().project.name, "A");
    }
}

// ---- help --------------------------------------------------------------------

#[test]
fn help_lists_project_commands_and_every_example_names_its_project() {
    let home = tempdir().unwrap();
    let top = agboard(home.path(), &["--help"]).success();
    let top = String::from_utf8_lossy(&top.get_output().stdout).to_string();
    // The SQLite-era commands are gone: none of them is listed.
    for removed in ["export", "import", "migrate"] {
        assert!(
            !top.lines()
                .any(|line| line.trim_start().starts_with(&format!("{removed} "))),
            "{removed} is listed in --help"
        );
    }
    assert!(top.contains("project"));
    assert!(top.contains("agboard project ls --json"));
    assert!(top.contains("rename"));
    assert!(!top.contains("--name"));

    let mut commands: Vec<Vec<&str>> = [
        "init",
        "add",
        "edit",
        "mv",
        "state",
        "rm",
        "ls",
        "show",
        "snapshot",
        "hook",
        "wait",
        "workspace",
        "serve",
    ]
    .iter()
    .map(|c| vec![*c])
    .collect();
    commands.extend([
        vec!["project", "create"],
        vec!["project", "ls"],
        vec!["project", "rename"],
        vec!["project", "rm"],
    ]);
    for command in commands {
        let help = agboard(home.path(), &[command.as_slice(), &["--help"]].concat()).success();
        let help = String::from_utf8_lossy(&help.get_output().stdout).to_string();
        let examples: Vec<&str> = help
            .lines()
            .filter(|line| line.trim_start().starts_with("agboard "))
            .collect();
        assert!(!examples.is_empty(), "{command:?} has no example:\n{help}");
        for example in examples {
            // `ls --all-projects` reads every project and names none.
            let global = matches!(
                command.as_slice(),
                ["serve"] | ["project", "create"] | ["project", "ls"]
            ) || example.contains("--all-projects");
            assert_eq!(
                example.contains("--project"),
                !global,
                "{command:?}: {example}"
            );
        }
    }
}
