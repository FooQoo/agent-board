//! Starting the server when a command needs it, and its stopping by itself.
//!
//! These tests run the real binary with `AGBOARD_HOME` in a temporary
//! directory and with autostart on. `AGBOARD_AUTOSTART_PORT=0` makes every
//! automatic server listen on a port the OS picks, never 7420. A guard kills
//! every server a test started, even when the test fails.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const STARTED_PREFIX: &str = "Started the Agent Board server at http://127.0.0.1:";
const QUESTION: &str = r#"{"questions":[{"question":"Which?","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}"#;
const STARTED_SUFFIX: &str = "/ in the background. It stops by itself after ";

struct Board {
    home: tempfile::TempDir,
    folder: PathBuf,
    env: Vec<(&'static str, String)>,
}

impl Board {
    fn new() -> Self {
        Self::with_env(&[])
    }

    fn with_env(extra: &[(&'static str, &str)]) -> Self {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("project-folder");
        std::fs::create_dir_all(&folder).unwrap();
        let mut env = vec![("AGBOARD_AUTOSTART_PORT", "0".to_string())];
        env.extend(extra.iter().map(|(k, v)| (*k, v.to_string())));
        let board = Self { home, folder, env };
        let created = board.run(&[
            "project",
            "create",
            "Auto",
            "--folder",
            board.folder.to_str().unwrap(),
        ]);
        assert!(created.status.success(), "{created:?}");
        board
    }

    fn dir(&self) -> &Path {
        self.home.path()
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_agboard"));
        command
            .env_remove("AGBOARD_AUTOSTART")
            .env_remove("AGBOARD_IDLE_TIMEOUT")
            .env("AGBOARD_WATCH", "poll")
            .env("AGBOARD_HOME", self.dir())
            .env("TZ", "UTC")
            .envs(self.env.iter().map(|(k, v)| (*k, v.as_str())))
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    fn spawn(&self, args: &[&str]) -> Child {
        self.command()
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }

    /// `wait --until task` that gives up after `seconds`.
    fn wait_args(seconds: &str) -> Vec<&str> {
        vec![
            "--project",
            "Auto",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            seconds,
        ]
    }

    fn serve_info(&self) -> Option<Value> {
        let text = std::fs::read_to_string(self.dir().join("serve.json")).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn hook(&self) -> Output {
        let mut child = self
            .command()
            .current_dir(&self.folder)
            .args(["hook", "--agent", "claude"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"hook_event_name":"SessionStart"}"#)
            .unwrap();
        child.wait_with_output().unwrap()
    }
}

impl Drop for Board {
    fn drop(&mut self) {
        if let Some(pid) = self.serve_info().and_then(|info| info["pid"].as_u64()) {
            kill(pid as i32);
        }
        // A server that already left serve.json behind is found by its lock.
        for pid in pids_holding(self.dir()) {
            kill(pid);
        }
    }
}

fn kill(pid: i32) {
    if pid > 0 {
        // SAFETY: sending a signal changes no memory of this process.
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
}

/// The automatic servers whose working directory is `dir`.
fn pids_holding(dir: &Path) -> Vec<i32> {
    let Ok(output) = Command::new("lsof")
        .args(["-t", "-a", "-d", "cwd", "+D"])
        .arg(dir)
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .filter(|pid| *pid != std::process::id() as i32)
        .collect()
}

fn alive(pid: u64) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn until(limit: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    done()
}

fn started_line(stderr: &str) -> Option<&str> {
    stderr.lines().find(|line| line.starts_with(STARTED_PREFIX))
}

fn started_port(stderr: &str) -> u16 {
    let line = started_line(stderr).unwrap_or_else(|| panic!("no start line in {stderr:?}"));
    assert!(line.ends_with(" without use."), "{line}");
    let (port, _) = line[STARTED_PREFIX.len()..]
        .split_once(STARTED_SUFFIX)
        .unwrap_or_else(|| panic!("{line}"));
    port.parse().unwrap()
}

/// Start a server with a short wait, and return its port.
fn start_by_waiting(board: &Board) -> u16 {
    let output = board.run(&Board::wait_args("1"));
    let stderr = text(&output.stderr);
    assert_eq!(output.status.code(), Some(0), "{stderr}");
    started_port(&stderr)
}

#[test]
fn a_wait_starts_the_server_once_and_hears_a_new_task() {
    let board = Board::new();
    let waiter = board.spawn(&Board::wait_args("20"));
    assert!(
        until(Duration::from_secs(20), || board.serve_info().is_some()),
        "the wait should start a server"
    );
    let info = board.serve_info().unwrap();
    assert_eq!(info["mode"], "auto");
    assert_eq!(info["idleTimeoutSeconds"], 1800);
    assert_ne!(info["port"], 7420);
    std::thread::sleep(Duration::from_millis(500));

    let added = board.run(&[
        "--project",
        "Auto",
        "add",
        "Heard",
        "--assignee",
        "ai",
        "--actor",
        "human",
    ]);
    assert!(added.status.success(), "{added:?}");
    let output = waiter.wait_with_output().unwrap();
    let stdout = text(&output.stdout);
    let stderr = text(&output.stderr);
    assert!(output.status.success(), "{stdout}\n{stderr}");
    assert!(stdout.contains("Heard"), "{stdout}");
    assert_eq!(started_port(&stderr), info["port"].as_u64().unwrap() as u16);
    assert!(
        stderr.contains("in the background. It stops by itself after 30 minutes without use."),
        "{stderr}"
    );
    assert!(
        !stdout.contains(STARTED_PREFIX),
        "standard output stays the command's own"
    );

    // The next command uses the running server and says nothing about it.
    let again = board.run(&Board::wait_args("1"));
    assert!(started_line(&text(&again.stderr)).is_none(), "{again:?}");
    assert_eq!(board.serve_info().unwrap()["pid"], info["pid"]);
}

#[test]
fn commands_that_do_not_need_the_server_start_none() {
    let board = Board::new();
    for args in [
        vec![
            "--project",
            "Auto",
            "add",
            "Quiet",
            "--assignee",
            "ai",
            "--actor",
            "ai",
        ],
        vec!["--project", "Auto", "ls"],
        vec!["--project", "Auto", "progress"],
        vec![
            "--project",
            "Auto",
            "qa",
            "ask",
            "--actor",
            "ai",
            "--task",
            "1",
            "--no-wait",
            "--request-json",
            QUESTION,
        ],
    ] {
        let output = board.run(&args);
        assert!(output.status.success(), "{args:?}: {output:?}");
    }
    std::thread::sleep(Duration::from_millis(300));
    assert!(board.serve_info().is_none());
    assert!(!board.dir().join("serve.log").exists());
}

#[test]
fn a_question_that_waits_starts_the_server_before_it_is_saved() {
    let board = Board::new();
    let added = board.run(&[
        "--project",
        "Auto",
        "add",
        "Ask",
        "--assignee",
        "ai",
        "--actor",
        "ai",
    ]);
    assert!(added.status.success(), "{added:?}");
    let asked = board.run(&[
        "--project",
        "Auto",
        "qa",
        "ask",
        "--actor",
        "ai",
        "--task",
        "1",
        "--timeout",
        "1",
        "--request-json",
        QUESTION,
        "--json",
    ]);
    let stderr = text(&asked.stderr);
    started_port(&stderr);
    assert_eq!(board.serve_info().unwrap()["mode"], "auto");
    // The question was saved once the server was there, and the wait ran.
    assert_eq!(asked.status.code(), Some(5), "{asked:?}");
    let events: Vec<Value> = text(&asked.stdout)
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(events.first().unwrap()["type"], "registered");
    assert_eq!(events.last().unwrap()["type"], "timeout");
}

#[test]
fn commands_started_together_share_one_server() {
    let board = Board::new();
    let waiters: Vec<Child> = (0..4)
        .map(|_| board.spawn(&Board::wait_args("3")))
        .collect();
    let outputs: Vec<Output> = waiters
        .into_iter()
        .map(|w| w.wait_with_output().unwrap())
        .collect();
    let mut started = 0;
    for output in &outputs {
        let stderr = text(&output.stderr);
        assert_eq!(output.status.code(), Some(0), "{stderr}");
        started += usize::from(started_line(&stderr).is_some());
    }
    assert_eq!(started, 1, "exactly one command starts the server");
    let pid = board.serve_info().unwrap()["pid"].as_u64().unwrap();
    assert!(alive(pid));
    assert_eq!(pids_holding(board.dir()), vec![pid as i32]);
}

#[test]
fn an_unused_server_stops_by_itself_and_the_next_wait_starts_another() {
    let board = Board::with_env(&[
        ("AGBOARD_IDLE_TIMEOUT", "60"),
        ("AGBOARD_IDLE_CHECK_MS", "500"),
    ]);
    let output = board.run(&Board::wait_args("1"));
    let stderr = text(&output.stderr);
    assert!(
        stderr.contains("It stops by itself after 1 minute without use."),
        "{stderr}"
    );
    let info = board.serve_info().unwrap();
    assert_eq!(info["idleTimeoutSeconds"], 60);
    let pid = info["pid"].as_u64().unwrap();

    assert!(
        until(Duration::from_secs(75), || !alive(pid)),
        "the server should stop after a minute without use"
    );
    assert!(board.serve_info().is_none(), "serve.json is removed");
    let log = std::fs::read_to_string(board.dir().join("serve.log")).unwrap();
    assert!(log.contains("Stopped after 1 minute without use."), "{log}");
    // It let go of the data directory, so the next wait starts a new server.
    let next = board.run(&Board::wait_args("1"));
    assert!(started_line(&text(&next.stderr)).is_some(), "{next:?}");
}

#[test]
fn an_open_event_stream_keeps_the_server_running() {
    let board = Board::with_env(&[
        ("AGBOARD_IDLE_TIMEOUT", "60"),
        ("AGBOARD_IDLE_CHECK_MS", "500"),
    ]);
    let port = start_by_waiting(&board);
    let pid = board.serve_info().unwrap()["pid"].as_u64().unwrap();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
    write!(
        stream,
        "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/event-stream\r\n\r\n"
    )
    .unwrap();
    let mut first = [0u8; 12];
    stream.read_exact(&mut first).unwrap();
    assert_eq!(&first, b"HTTP/1.1 200");

    std::thread::sleep(Duration::from_secs(70));
    assert!(alive(pid), "a browser tab keeps the server running");
    assert_eq!(board.serve_info().unwrap()["mode"], "auto");
}

#[test]
fn serve_d_keeps_an_automatic_server_and_a_foreground_serve_points_to_it() {
    let board = Board::new();
    let port = start_by_waiting(&board);
    let pid = board.serve_info().unwrap()["pid"].clone();

    let foreground = board.run(&["--json", "serve", "--port", "0"]);
    assert!(!foreground.status.success());
    let error: Value = serde_json::from_slice(&foreground.stderr).unwrap();
    assert_eq!(error["error"]["code"], "already_serving");
    assert!(
        error["error"]["reason"]
            .as_str()
            .unwrap()
            .contains("agboard serve -d"),
        "{error}"
    );

    let kept = board.run(&["serve", "-d"]);
    let stdout = text(&kept.stdout);
    assert!(kept.status.success(), "{kept:?}");
    assert!(
        stdout.starts_with(&format!(
            "Serving at http://127.0.0.1:{port}/ in the background"
        )),
        "{stdout}"
    );
    let info = board.serve_info().unwrap();
    assert_eq!(info["pid"], pid, "the same server keeps running");
    assert_eq!(info["mode"], "manual");
    assert!(
        info.get("idleTimeoutSeconds").is_none_or(Value::is_null),
        "{info}"
    );
}

#[test]
fn the_hook_starts_the_server_in_the_background_but_not_after_stop() {
    let board = Board::new();
    let hooked = board.hook();
    assert!(hooked.status.success(), "{hooked:?}");
    assert!(
        text(&hooked.stdout).contains("AGBOARD_PROGRESS"),
        "{hooked:?}"
    );
    assert!(
        until(Duration::from_secs(20), || board.serve_info().is_some()),
        "the hook should start a server"
    );
    assert_eq!(board.serve_info().unwrap()["mode"], "auto");

    let stopped = board.run(&["stop"]);
    assert!(stopped.status.success(), "{stopped:?}");
    assert!(
        text(&stopped.stdout)
            .contains("A command that waits for the board starts it again automatically."),
        "{stopped:?}"
    );
    assert!(board.dir().join("autostart.paused").exists());

    let hooked = board.hook();
    assert!(hooked.status.success(), "{hooked:?}");
    std::thread::sleep(Duration::from_secs(2));
    assert!(board.serve_info().is_none(), "the hook honors stop");

    // A wait starts it again and lets the hook start it later.
    start_by_waiting(&board);
    assert!(!board.dir().join("autostart.paused").exists());
}

#[test]
fn autostart_off_keeps_the_old_error() {
    let board = Board::with_env(&[("AGBOARD_AUTOSTART", "0")]);
    let output = board.run(&Board::wait_args("1"));
    assert!(!output.status.success(), "{output:?}");
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert!(
        error["error"]["reason"]
            .as_str()
            .unwrap()
            .contains("Run \"agboard serve\""),
        "{error}"
    );
    let hooked = board.hook();
    assert!(hooked.status.success());
    std::thread::sleep(Duration::from_millis(500));
    assert!(board.serve_info().is_none());
    assert!(!board.dir().join("serve.log").exists());
}

#[test]
fn a_taken_preferred_port_gives_another_and_says_why() {
    let held = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let taken = held.local_addr().unwrap().port();
    let board = Board::with_env(&[("AGBOARD_AUTOSTART_PORT", &taken.to_string())]);
    let output = board.run(&Board::wait_args("1"));
    let stderr = text(&output.stderr);
    let port = started_port(&stderr);
    assert_ne!(port, taken);
    assert!(
        stderr.contains(&format!(
            "Port {taken} is used by another program, so this server uses port {port}."
        )),
        "{stderr}"
    );
}

#[test]
fn a_manual_serve_names_what_holds_its_port() {
    let held = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let taken = held.local_addr().unwrap().port();
    let board = Board::new();
    let output = board.run(&["--json", "serve", "--port", &taken.to_string()]);
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "port_in_use");
    assert_eq!(
        error["error"]["reason"],
        format!("Port {taken} is used by another program. Choose another port with --port.")
    );
    drop(held);

    // Another Agent Board server, of another data folder, is named with its pid.
    let other = Board::new();
    let port = start_by_waiting(&other);
    let other_pid = other.serve_info().unwrap()["pid"].clone();
    let output = board.run(&["--json", "serve", "--port", &port.to_string()]);
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "port_in_use");
    assert_eq!(
        error["error"]["reason"],
        format!(
            "Port {port} is used by another Agent Board server (pid {other_pid}) with a different data folder. Choose another port with --port."
        )
    );
}
