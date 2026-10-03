//! `skan serve` and the automatic notification after a write.
//!
//! These tests run the real `skan` binary with `SKAN_HOME` in a temporary
//! directory and `TZ=UTC`. They use only ports 7620 to 7629 (never 7420) and
//! run one at a time, so a port can be reused from test to test. Every `skan
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
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

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
    elapsed: Duration,
}

fn run(home: &Path, args: &[&str]) -> Output {
    let start = Instant::now();
    let output = skan(home).args(args).output().unwrap();
    Output {
        code: output.status.code().unwrap(),
        out: String::from_utf8(output.stdout).unwrap(),
        err: String::from_utf8(output.stderr).unwrap(),
        elapsed: start.elapsed(),
    }
}

fn run_ok(home: &Path, args: &[&str]) -> Output {
    let o = run(home, args);
    assert_eq!(o.code, 0, "skan {args:?} failed: {}", o.err);
    o
}

/// A tempdir with an initialized board named "demo".
fn board() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    run_ok(home.path(), &["init", "--name", "demo"]);
    home
}

fn write_serve_json(home: &Path, pid: u32, port: u16) {
    let text = format!(r#"{{"pid":{pid},"port":{port},"started_at":"2026-01-01T00:00:00Z"}}"#);
    std::fs::write(home.join("serve.json"), text).unwrap();
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// A stand-in for `skan serve`: answers every request with 204 and reports the
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

/// A running `skan serve`. Dropping it stops the child (SIGTERM, then kill)
/// and checks that its port is free again.
struct Serving {
    child: Child,
    port: u16,
    lines: Receiver<String>,
}

impl Serving {
    fn spawn(home: &Path, args: &[&str], port: u16) -> Serving {
        let mut child = StdCommand::new(assert_cmd::cargo::cargo_bin("skan"))
            .args(args)
            .env("SKAN_HOME", home)
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

    /// `skan serve --port <port>`, waiting until it prints its first line.
    fn start(home: &Path, port: u16) -> (Serving, String) {
        let mut serving = Serving::spawn(home, &["serve", "--port", &port.to_string()], port);
        let first = serving.first_line();
        (serving, first)
    }

    fn first_line(&mut self) -> String {
        self.lines
            .recv_timeout(Duration::from_secs(10))
            .expect("skan serve printed nothing within 10 s")
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
        let _ = StdCommand::new("kill")
            .args(["-TERM", &self.child.id().to_string()])
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
    let fake = FakeServe::start(home.path(), 7620);
    let commands: &[&[&str]] = &[
        &["add", "First card"],
        &["add", "Second card", "--desc", "Details"],
        &["edit", "1", "--title", "Renamed"],
        &["mv", "1", "doing"],
        &["state", "1", "running"],
    ];
    for args in commands {
        run_ok(home.path(), args);
        assert_eq!(
            fake.next(QUICK).as_deref(),
            Some(NOTIFY_LINE),
            "skan {args:?} sent no notification"
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
    let fake = FakeServe::start(home.path(), 7620);
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
