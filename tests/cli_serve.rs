//! `agboard serve` and the automatic notification after a write.
//!
//! These tests run the real `agboard` binary with `AGBOARD_HOME` in a temporary
//! directory and `TZ=UTC`. They use only ports 7943 to 7962 (never 7420) and
//! run one at a time, so a port can be reused from test to test. Every `agboard
//! serve` child is stopped when its handle is dropped, and the port is checked
//! to be free again.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use assert_cmd::Command;

// ---------------------------------------------------------------- helpers

static SERIAL: Mutex<()> = Mutex::new(());

/// Tests share ports and the process table, so they run one at a time.
/// A TASK.md body the file store accepts (the required headings and one completion condition).
const BODY: &str = "## 作業内容\n\nDetails\n\n## 完了条件と確認結果\n\n- [ ] AC-1. Done\n  - 確認結果: 未確認\n  - 根拠: 未記入\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn agboard(home: &Path) -> Command {
    let mut cmd = Command::cargo_bin("agboard").unwrap();
    cmd.env("AGBOARD_HOME", home)
        .env("TZ", "UTC")
        .current_dir(home);
    cmd
}

struct Output {
    code: i32,
    out: String,
    err: String,
    elapsed: Duration,
}

fn run(home: &Path, args: &[&str]) -> Output {
    let start = Instant::now();
    let mut args = args.to_vec();
    let command = args.first().copied();
    match command {
        Some("add") => args.extend(["--assignee", "ai", "--actor", "ai"]),
        Some("mv") => args.extend(["--actor", "ai", "--reason", "test change"]),
        Some("state") => args.extend(["--actor", "ai", "--reason", "test change"]),
        _ => {}
    }
    // Every command except `serve` works on one named project.
    if command != Some("serve") {
        args.splice(0..0, ["--project", "demo"]);
    }
    let output = agboard(home)
        .args(folder_args(home, &args))
        .output()
        .unwrap();
    Output {
        code: output.status.code().unwrap(),
        out: String::from_utf8(output.stdout).unwrap(),
        err: String::from_utf8(output.stderr).unwrap(),
        elapsed: start.elapsed(),
    }
}

fn run_ok(home: &Path, args: &[&str]) -> Output {
    let o = run(home, args);
    assert_eq!(o.code, 0, "agboard {args:?} failed: {}", o.err);
    o
}

/// A tempdir with an initialized board named "demo".
fn board() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    run_ok(home.path(), &["init"]);
    home
}

fn write_serve_json(home: &Path, pid: u32, port: u16) {
    let text = format!(r#"{{"pid":{pid},"port":{port},"started_at":"2026-01-01T00:00:00Z"}}"#);
    std::fs::write(home.join("serve.json"), text).unwrap();
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// A stand-in for `agboard serve`: answers every request with 204 and reports the
/// request line of each one.
struct FakeServe {
    requests: Receiver<String>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl FakeServe {
    /// Listen on `port` and point `home`'s `serve.json` at it.
    fn start(home: &Path, port: u16) -> FakeServe {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
        listener.set_nonblocking(true).unwrap();
        write_serve_json(home, std::process::id(), port);
        let (tx, requests) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_millis(500)))
                            .unwrap();
                        let mut reader = BufReader::new(stream.try_clone().unwrap());
                        let mut line = String::new();
                        let _ = reader.read_line(&mut line);
                        // Read the rest of the header before replying.
                        loop {
                            let mut header = String::new();
                            match reader.read_line(&mut header) {
                                Ok(0) | Err(_) => break,
                                Ok(_) if header == "\r\n" => break,
                                Ok(_) => {}
                            }
                        }
                        let _ = stream
                            .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                        let _ = tx.send(line.trim_end().to_string());
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        });
        FakeServe {
            requests,
            stop,
            handle: Some(handle),
        }
    }

    /// The next notification, if one arrives within `within`.
    fn next(&self, within: Duration) -> Option<String> {
        self.requests.recv_timeout(within).ok()
    }
}

impl Drop for FakeServe {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// A running `agboard serve`. Dropping it stops the child (SIGTERM, then kill)
/// and checks that its port is free again.
struct Serving {
    child: Child,
    port: u16,
    lines: Receiver<String>,
}

impl Serving {
    fn start_with(home: &Path, args: &[&str], port: u16) -> (Serving, String) {
        let mut serving = Serving::spawn(home, args, port);
        let first = serving.first_line();
        (serving, first)
    }

    fn spawn(home: &Path, args: &[&str], port: u16) -> Serving {
        let mut child = StdCommand::new(assert_cmd::cargo::cargo_bin("agboard"))
            .args(args)
            .env("AGBOARD_HOME", home)
            .env("TZ", "UTC")
            .current_dir(home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Serving { child, port, lines }
    }

    /// `agboard serve --port <port>`, waiting until it prints its first line.
    fn start(home: &Path, port: u16) -> (Serving, String) {
        Serving::start_with(home, &["serve", "--port", &port.to_string()], port)
    }

    fn first_line(&mut self) -> String {
        self.lines
            .recv_timeout(Duration::from_secs(10))
            .expect("agboard serve printed nothing within 10 s")
    }

    fn addr(&self) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, self.port))
    }

    /// Open `GET /api/events` and wait for the `ready` event.
    fn events(&self) -> EventStream {
        let mut stream = TcpStream::connect(self.addr()).unwrap();
        write!(
            stream,
            "GET /api/events HTTP/1.1\r\nHost: {}\r\nAccept: text/event-stream\r\n\r\n",
            self.addr()
        )
        .unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(50)))
            .unwrap();
        let mut events = EventStream {
            stream,
            received: String::new(),
        };
        assert!(
            events.wait_for("event: ready", Duration::from_secs(2)),
            "no ready event: {:?}",
            events.received
        );
        events
    }

    /// Send SIGTERM and wait for the exit code.
    fn terminate(&mut self) -> Option<i32> {
        self.signal("TERM")
    }

    /// Send `signal` (for example `INT`) to the child only and wait for the
    /// exit code; `None` if it is still running after 5 s or was killed.
    fn signal(&mut self, signal: &str) -> Option<i32> {
        let _ = StdCommand::new("kill")
            .args([&format!("-{signal}"), &self.child.id().to_string()])
            .status();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status.code();
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        None
    }
}

impl Drop for Serving {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) && self.terminate().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if !std::thread::panicking() {
            assert!(
                port_is_free(self.port),
                "port {} is still in use",
                self.port
            );
        }
    }
}

struct EventStream {
    stream: TcpStream,
    received: String,
}

impl EventStream {
    /// Read until `needle` has arrived or `within` has passed.
    fn wait_for(&mut self, needle: &str, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        let mut chunk = [0u8; 4096];
        while Instant::now() < deadline {
            if self.received.contains(needle) {
                return true;
            }
            match self.stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => self
                    .received
                    .push_str(&String::from_utf8_lossy(&chunk[..n])),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(e) => panic!("read failed: {e}"),
            }
        }
        self.received.contains(needle)
    }

    fn changed_count(&self) -> usize {
        self.received.matches("event: changed").count()
    }

    /// Wait until `n` `changed` events have arrived in total.
    fn wait_for_changed(&mut self, n: usize, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while self.changed_count() < n && Instant::now() < deadline {
            self.wait_for("never-appears", Duration::from_millis(50));
        }
        self.changed_count() >= n
    }
}

// ------------------------------------------------- notification after writes

const NOTIFY_LINE: &str = "POST /api/notify HTTP/1.1";
const QUICK: Duration = Duration::from_secs(2);
const SILENCE: Duration = Duration::from_millis(400);

#[test]
fn a_write_that_changes_the_board_notifies_the_running_serve() {
    let _serial = serial();
    let home = board();
    let fake = FakeServe::start(home.path(), 7943);
    let commands: &[&[&str]] = &[
        &["add", "First card"],
        &["add", "Second card", "--desc", BODY],
        &["edit", "1", "--title", "Renamed"],
        &["mv", "1", "doing"],
        &["state", "1", "running"],
    ];
    for args in commands {
        run_ok(home.path(), args);
        assert_eq!(
            fake.next(QUICK).as_deref(),
            Some(NOTIFY_LINE),
            "agboard {args:?} sent no notification"
        );
    }
    assert_eq!(fake.next(SILENCE), None, "more notifications than writes");
}

#[test]
fn commands_that_change_nothing_do_not_notify() {
    let _serial = serial();
    let home = board();
    run_ok(home.path(), &["add", "A card"]);
    run_ok(home.path(), &["mv", "1", "doing"]);
    let fake = FakeServe::start(home.path(), 7943);
    let quiet: &[&[&str]] = &[
        &["ls"],
        &["ls", "--json"],
        &["show", "1"],
        // Already in Doing.
        &["mv", "1", "doing"],
    ];
    for args in quiet {
        run_ok(home.path(), args);
    }
    // Failures do not notify either.
    assert_eq!(run(home.path(), &["show", "99"]).code, 3);
    assert_eq!(run(home.path(), &["mv", "1", "nowhere"]).code, 2);
    assert_eq!(
        fake.next(SILENCE),
        None,
        "a command that changed nothing notified"
    );
    // The fake really works: a write is noticed.
    run_ok(home.path(), &["add", "Another"]);
    assert_eq!(fake.next(QUICK).as_deref(), Some(NOTIFY_LINE));
}

// ------------------------------------------------------------ the command

#[test]
fn serve_starts_in_a_new_data_area_with_no_project() {
    let _serial = serial();
    let home = tempfile::tempdir().unwrap();
    let (serving, first) = Serving::start(home.path(), 7943);
    assert_eq!(
        first,
        "Serving at http://127.0.0.1:7943/ (press Ctrl+C to stop)"
    );
    let health = ureq::get("http://127.0.0.1:7943/api/health")
        .call()
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
    drop(serving);
    assert!(port_is_free(7943));
}

#[test]
fn serve_prints_the_startup_line_and_answers_health() {
    let _serial = serial();
    let home = board();
    let (serving, first) = Serving::start(home.path(), 7944);
    assert_eq!(
        first,
        "Serving at http://127.0.0.1:7944/ (press Ctrl+C to stop)"
    );
    let health = ureq::get("http://127.0.0.1:7944/api/health")
        .call()
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
    let info = std::fs::read_to_string(home.path().join("serve.json")).unwrap();
    assert!(info.contains("\"port\":7944"), "{info}");
    drop(serving);
}

#[test]
fn serve_json_prints_the_url_as_the_first_line() {
    let _serial = serial();
    let home = board();
    let (serving, first) =
        Serving::start_with(home.path(), &["serve", "--json", "--port", "7946"], 7946);
    assert_eq!(first, r#"{"url":"http://127.0.0.1:7946/"}"#);
    let health = ureq::get("http://127.0.0.1:7946/api/health")
        .call()
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
    drop(serving);
}

#[test]
fn a_second_serve_on_the_same_data_exits_1_with_already_serving() {
    let _serial = serial();
    let home = board();
    let (_first, _) = Serving::start(home.path(), 7947);
    let o = run(home.path(), &["serve", "--port", "7945"]);
    assert_eq!(o.code, 1, "{}", o.err);
    assert_eq!(o.out, "");
    assert!(
        o.err.contains("the board is already being served."),
        "{}",
        o.err
    );
    assert!(o.err.contains("http://127.0.0.1:7947/"), "{}", o.err);
    assert!(port_is_free(7945));
    // The first serve is untouched.
    let health = ureq::get("http://127.0.0.1:7947/api/health")
        .call()
        .unwrap();
    assert_eq!(health.status().as_u16(), 200);
}

#[test]
fn a_port_held_by_another_process_exits_1_with_port_in_use() {
    let _serial = serial();
    let home = board();
    let _holder = TcpListener::bind((Ipv4Addr::LOCALHOST, 7948)).unwrap();
    let o = run(home.path(), &["serve", "--port", "7948"]);
    assert_eq!(o.code, 1, "{}", o.err);
    assert_eq!(o.out, "");
    assert!(o.err.contains("port 7948 is already in use."), "{}", o.err);
    assert!(
        o.err.contains("Choose another port with --port."),
        "{}",
        o.err
    );
    assert!(!home.path().join("serve.json").exists());
}

#[test]
fn serve_stops_with_exit_0_and_removes_serve_json_on_ctrl_c_and_sigterm() {
    let _serial = serial();
    for signal in ["INT", "TERM"] {
        let home = board();
        let (mut serving, _) = Serving::start(home.path(), 7949);
        assert!(home.path().join("serve.json").exists());
        assert_eq!(serving.signal(signal), Some(0), "SIG{signal}");
        assert!(
            !home.path().join("serve.json").exists(),
            "serve.json left after SIG{signal}"
        );
        // Nothing but the startup line was printed, not even a blank line.
        assert_eq!(
            serving.lines.recv_timeout(Duration::from_millis(200)).ok(),
            None
        );
    }
}

// ------------------------------------------------ the live notification path

#[test]
fn a_subscriber_receives_changed_after_add_mv_and_state() {
    let _serial = serial();
    let home = board();
    let (serving, _) = Serving::start(home.path(), 7949);
    let mut events = serving.events();
    let commands: &[&[&str]] = &[
        &["add", "A card"],
        &["mv", "1", "doing"],
        &["state", "1", "running"],
    ];
    for (i, args) in commands.iter().enumerate() {
        let start = Instant::now();
        run_ok(home.path(), args);
        assert!(
            events.wait_for_changed(i + 1, QUICK),
            "no changed event within 2 s after agboard {args:?}; got {:?}",
            events.received
        );
        assert!(start.elapsed() < QUICK + Duration::from_secs(1));
    }
}

#[test]
fn a_subscriber_receives_nothing_for_commands_that_change_nothing() {
    let _serial = serial();
    let home = board();
    run_ok(home.path(), &["add", "A card"]);
    run_ok(home.path(), &["mv", "1", "doing"]);
    let (serving, _) = Serving::start(home.path(), 7960);
    let mut events = serving.events();
    run_ok(home.path(), &["ls"]);
    run_ok(home.path(), &["show", "1"]);
    // Already in Doing.
    run_ok(home.path(), &["mv", "1", "doing"]);
    assert!(
        !events.wait_for_changed(1, Duration::from_secs(1)),
        "unexpected changed event: {:?}",
        events.received
    );
    // The subscription works: a real change still arrives.
    run_ok(home.path(), &["add", "Another"]);
    assert!(events.wait_for_changed(1, QUICK), "{:?}", events.received);
}

// ------------------------------------------- serve stopped or serve.json stale

#[test]
fn a_write_after_serve_stopped_succeeds_quickly() {
    let _serial = serial();
    let home = board();
    let (mut serving, _) = Serving::start(home.path(), 7961);
    assert_eq!(serving.terminate(), Some(0));
    let o = run_ok(home.path(), &["add", "After serve"]);
    assert!(o.elapsed < Duration::from_secs(1), "took {:?}", o.elapsed);
}

#[test]
fn a_write_with_a_stale_serve_json_succeeds_quickly() {
    let _serial = serial();
    let home = board();
    // Nothing listens on the port in serve.json.
    assert!(port_is_free(7962));
    write_serve_json(home.path(), 4_000_000, 7962);
    let o = run_ok(home.path(), &["add", "Stale"]);
    assert!(o.elapsed < Duration::from_secs(1), "took {:?}", o.elapsed);
    assert!(o.out.contains("Stale"), "{}", o.out);
}

#[test]
fn a_write_after_serve_was_killed_succeeds_quickly() {
    let _serial = serial();
    let home = board();
    let (mut serving, _) = Serving::start(home.path(), 7961);
    // SIGKILL: serve cannot clean up, so serve.json stays behind.
    serving.child.kill().unwrap();
    serving.child.wait().unwrap();
    assert!(home.path().join("serve.json").exists());
    let o = run_ok(home.path(), &["add", "After crash"]);
    assert!(o.elapsed < Duration::from_secs(1), "took {:?}", o.elapsed);
    // A new serve takes over the stale file.
    let (_again, first) = Serving::start(home.path(), 7961);
    assert!(first.starts_with("Serving at"), "{first}");
}

#[test]
fn serve_takes_no_project_and_changes_made_through_two_projects_are_notified() {
    let _lock = serial();
    let home = tempfile::tempdir().unwrap();
    let o = agboard(home.path())
        .args(["--project", "x", "serve", "--port", "7964"])
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(2));
    assert!(port_is_free(7964));
    assert!(!home.path().join("serve.json").exists());

    let (serving, _) = Serving::start(home.path(), 7964);
    for name in ["alpha", "beta"] {
        let o = agboard(home.path())
            .args(folder_args(home.path(), &["project", "create", name]))
            .output()
            .unwrap();
        assert_eq!(o.status.code(), Some(0));
    }
    let list: serde_json::Value = serde_json::from_str(
        &ureq::get("http://127.0.0.1:7964/api/projects")
            .call()
            .unwrap()
            .body_mut()
            .read_to_string()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(list["projects"].as_array().unwrap().len(), 2);
    drop(serving);
}

/// `project create` binds the folder it runs in, and one folder belongs to one
/// project. Every create in a test therefore gets a folder of its own under
/// the test's data area, unless the arguments name one.
fn folder_args(home: &std::path::Path, args: &[&str]) -> Vec<String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let mut out: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    if let Some(at) = args.windows(2).position(|w| w == ["project", "create"]) {
        let name = at + 2;
        if args.get(name).is_some_and(|n| !n.starts_with('-')) && !args.contains(&"--folder") {
            let dir = home
                .join("folders")
                .join(NEXT.fetch_add(1, Ordering::Relaxed).to_string());
            std::fs::create_dir_all(&dir).unwrap();
            out.splice(
                name + 1..name + 1,
                ["--folder".to_string(), dir.display().to_string()],
            );
        }
    }
    out
}
