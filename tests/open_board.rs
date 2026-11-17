//! Opening the board in the browser: once when a server starts automatically,
//! and on request with `agboard open`.
//!
//! These tests run the real binary with `AGBOARD_HOME` in a temporary
//! directory. No real browser is opened: `AGBOARD_BROWSER_OPENER` names a
//! script that appends the address it was given to `opened.txt`.
//! `AGBOARD_AUTOSTART_PORT=0` makes every automatic server listen on a port
//! the OS picks, and a guard kills every server a test started.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const QUESTION: &str = r#"{"questions":[{"body":"Which?","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}"#;

struct Board {
    home: tempfile::TempDir,
    folder: PathBuf,
    env: Vec<(&'static str, String)>,
}

impl Board {
    /// A board whose automatic server opens the browser after `grace_ms`.
    fn opening(grace_ms: &str) -> Self {
        Self::with_env(&[
            ("AGBOARD_OPEN_BROWSER", "1"),
            ("AGBOARD_OPEN_GRACE_MS", grace_ms),
        ])
    }

    fn with_env(extra: &[(&'static str, &str)]) -> Self {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("project-folder");
        std::fs::create_dir_all(&folder).unwrap();
        let opener = home.path().join("record-url");
        std::fs::write(
            &opener,
            "#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$(dirname \"$0\")/opened.txt\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&opener, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut env = vec![
            ("AGBOARD_AUTOSTART_PORT", "0".to_string()),
            ("AGBOARD_OPEN_BROWSER", "0".to_string()),
            ("AGBOARD_BROWSER_OPENER", opener.display().to_string()),
        ];
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
            .current_dir(&self.folder)
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    fn project_id(&self) -> String {
        let listed = self.run(&["--json", "project", "ls"]);
        let value: Value = serde_json::from_slice(&listed.stdout).unwrap();
        value["projects"][0]["id"].as_str().unwrap().to_string()
    }

    fn serve_info(&self) -> Option<Value> {
        let text = std::fs::read_to_string(self.dir().join("serve.json")).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn port(&self) -> u64 {
        self.serve_info().unwrap()["port"].as_u64().unwrap()
    }

    fn board_url(&self) -> String {
        format!(
            "http://127.0.0.1:{}/?project={}",
            self.port(),
            self.project_id()
        )
    }

    /// The addresses the fake opener was given, one per opening.
    fn opened(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir().join("opened.txt"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn log(&self) -> String {
        std::fs::read_to_string(self.dir().join("serve.log")).unwrap_or_default()
    }

    /// Start a server with a short wait for a task.
    fn start_by_waiting(&self) {
        let output = self.run(&[
            "--project",
            "Auto",
            "--json",
            "wait",
            "--until",
            "task",
            "--idle-timeout",
            "1",
        ]);
        assert_eq!(output.status.code(), Some(0), "{output:?}");
        assert!(self.serve_info().is_some());
    }

    fn hook(&self) {
        let mut child = self
            .command()
            .args(["hook", "--agent", "claude"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"hook_event_name":"SessionStart"}"#)
            .unwrap();
        assert!(child.wait().unwrap().success());
    }
}

impl Drop for Board {
    fn drop(&mut self) {
        if let Some(pid) = self.serve_info().and_then(|info| info["pid"].as_u64()) {
            kill(pid as i32);
        }
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

/// The servers whose working directory is `dir`.
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

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn an_automatic_server_opens_its_projects_board_once() {
    let board = Board::opening("200");
    board.start_by_waiting();
    assert!(
        until(Duration::from_secs(10), || !board.opened().is_empty()),
        "the server should open the board: {}",
        board.log()
    );
    let url = board.board_url();
    assert_eq!(board.opened(), vec![url.clone()]);
    assert!(
        board
            .log()
            .contains(&format!("Opened {url} in the browser.")),
        "{}",
        board.log()
    );

    // The waiting command's own stream is not a board page, and a later
    // command that uses the running server opens nothing.
    board.start_by_waiting();
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(board.opened().len(), 1);
}

#[test]
fn the_hook_start_opens_the_board_too() {
    let board = Board::opening("200");
    board.hook();
    assert!(
        until(Duration::from_secs(20), || !board.opened().is_empty()),
        "{}",
        board.log()
    );
    assert_eq!(board.opened(), vec![board.board_url()]);
}

#[test]
fn a_board_page_that_connects_first_keeps_the_browser_closed() {
    let board = Board::opening("4000");
    board.hook();
    assert!(until(Duration::from_secs(20), || {
        board
            .serve_info()
            .is_some_and(|info| info["port"].as_u64().is_some_and(|port| port > 0))
    }));
    // An old tab reconnects.
    let port = board.port();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port as u16)).unwrap();
    write!(
        stream,
        "GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: text/event-stream\r\n\r\n"
    )
    .unwrap();
    let mut first = [0u8; 12];
    stream.read_exact(&mut first).unwrap();
    assert_eq!(&first, b"HTTP/1.1 200");
    std::thread::sleep(Duration::from_secs(5));
    assert!(board.opened().is_empty(), "{:?}", board.opened());
    assert!(!board.log().contains("in the browser"), "{}", board.log());
}

#[test]
fn a_manual_server_and_a_question_open_nothing() {
    let board = Board::opening("200");
    let started = board.run(&["serve", "-d", "--port", "0"]);
    assert!(started.status.success(), "{started:?}");
    let added = board.run(&[
        "--project",
        "Auto",
        "add",
        "Ask",
        "--assignee",
        "ai",
        "--actor",
        "human",
    ]);
    assert!(added.status.success(), "{added:?}");
    let asked = board.run(&[
        "--project",
        "Auto",
        "message",
        "ask",
        "--actor",
        "ai",
        "--task",
        "1",
        "--timeout",
        "1",
        "--questions-json",
        QUESTION,
    ]);
    assert_eq!(asked.status.code(), Some(5), "{asked:?}");
    std::thread::sleep(Duration::from_secs(1));
    assert!(board.opened().is_empty(), "{:?}", board.opened());
}

#[test]
fn opening_can_be_turned_off() {
    let board = Board::with_env(&[("AGBOARD_OPEN_GRACE_MS", "200")]);
    board.start_by_waiting();
    assert!(
        until(Duration::from_secs(10), || board
            .log()
            .contains("AGBOARD_OPEN_BROWSER=0")),
        "{}",
        board.log()
    );
    assert!(board.opened().is_empty());
}

#[test]
fn open_starts_the_server_and_opens_the_bound_projects_board() {
    let board = Board::opening("200");
    let output = board.run(&["open"]);
    let stdout = text(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(
        text(&output.stderr).starts_with("Started the Agent Board server at"),
        "{output:?}"
    );
    let url = board.board_url();
    assert_eq!(stdout, format!("Opened {url} in your browser.\n"));
    assert!(until(Duration::from_secs(5), || !board.opened().is_empty()));
    assert_eq!(board.opened(), vec![url.clone()]);
    // The server it started does not open a second page.
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(board.opened().len(), 1);

    // A running server is used as it is, and opened again on request.
    let again = board.run(&["--project", "Auto", "--json", "open"]);
    assert!(again.status.success(), "{again:?}");
    let value: Value = serde_json::from_slice(&again.stdout).unwrap();
    assert_eq!(value["url"], url);
    assert_eq!(value["projectId"], board.project_id());
    assert_eq!(value["opened"], true);
    assert!(value.get("notice").is_none(), "{value}");
    assert!(until(Duration::from_secs(5), || board.opened().len() == 2));
}

#[test]
fn open_print_only_prints_the_address() {
    let board = Board::opening("200");
    board.start_by_waiting();
    assert!(until(Duration::from_secs(10), || !board
        .opened()
        .is_empty()));
    let url = board.board_url();
    let printed = board.run(&["open", "--print"]);
    assert!(printed.status.success(), "{printed:?}");
    assert_eq!(text(&printed.stdout), format!("{url}\n"));
    let json = board.run(&["--json", "open", "--print"]);
    let value: Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(value["url"], url);
    assert_eq!(value["opened"], false);
    assert_eq!(board.opened().len(), 1);
}

#[test]
fn open_says_why_the_browser_stayed_closed() {
    let board = Board::new_off();
    let output = board.run(&["open"]);
    assert!(output.status.success(), "{output:?}");
    let url = board.board_url();
    assert_eq!(
        text(&output.stdout),
        format!(
            "{url}\nThe browser was not opened. AGBOARD_OPEN_BROWSER=0 turns opening the browser off. Open the address yourself.\n"
        )
    );
    let json = board.run(&["--json", "open"]);
    let value: Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(value["opened"], false);
    assert_eq!(
        value["notice"],
        "AGBOARD_OPEN_BROWSER=0 turns opening the browser off."
    );
    assert!(board.opened().is_empty());
}

#[test]
fn open_without_autostart_needs_a_running_server() {
    let board = Board::with_env(&[("AGBOARD_AUTOSTART", "0"), ("AGBOARD_OPEN_BROWSER", "1")]);
    let output = board.run(&["--json", "open"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "board_unavailable");
    assert!(
        error["error"]["reason"]
            .as_str()
            .unwrap()
            .contains("agboard serve -d"),
        "{error}"
    );
    assert!(board.serve_info().is_none());
    assert!(board.opened().is_empty());
}

#[test]
fn an_opener_that_cannot_start_is_an_error_that_names_the_address() {
    let board = Board::with_env(&[
        ("AGBOARD_OPEN_BROWSER", "1"),
        ("AGBOARD_BROWSER_OPENER", "/nonexistent/agboard-opener"),
    ]);
    let output = board.run(&["--json", "open"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    // The line before it says that the server was started.
    let stderr = text(&output.stderr);
    let error: Value = serde_json::from_str(stderr.lines().last().unwrap()).unwrap();
    assert_eq!(error["error"]["code"], "browser_open_failed");
    let reason = error["error"]["reason"].as_str().unwrap();
    assert!(
        reason.contains(&format!(
            "Open {} in your browser yourself.",
            board.board_url()
        )),
        "{reason}"
    );
}

impl Board {
    /// A board whose browser opening is off, as in every other test.
    fn new_off() -> Self {
        Self::with_env(&[])
    }
}
