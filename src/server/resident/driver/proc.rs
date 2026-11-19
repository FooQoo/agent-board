//! The child process behind a driver: spawning it in its own process group with the scrubbed
//! environment, draining its output and error streams, reaping it, and stopping it.

use std::ffi::OsString;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::lines::{Line, MAX_LINE, for_each_line};
use super::{DriverEvent, StartSpec};
use crate::error::AgboardError;
use crate::server::resident::cli;
use crate::server::resident::process::{
    Exit, group_alive, kill_members, signal_group, wait_group_gone,
};

/// How long a session gets to end by itself after its input is closed, before SIGTERM.
const INPUT_GRACE: Duration = Duration::from_millis(1500);
/// How long the reaper waits for the output streams to end after the child exited. A command the
/// child started in the background can hold them open for much longer.
const STREAM_GRACE: Duration = Duration::from_millis(500);

pub(super) type SharedStdin = Arc<Mutex<Option<ChildStdin>>>;

/// The session log, written by the reader threads and the driver.
#[derive(Clone)]
pub(super) struct Log(Arc<Mutex<File>>);

impl Log {
    pub(super) fn line(&self, text: &str) {
        let mut file = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(file, "{text}");
    }

    /// A note of the board's own, marked so it is not taken for CLI output.
    pub(super) fn note(&self, text: &str) {
        self.line(&format!("agboard: {text}"));
    }
}

/// What the reader of the output stream gets to work with.
pub(super) struct Out {
    pub events: Sender<DriverEvent>,
    pub stdin: SharedStdin,
    pub log: Log,
    /// Set while a turn runs; the reader keeps it in step with the CLI's own messages.
    pub busy: Arc<AtomicBool>,
}

pub(super) type Reader = Box<dyn FnOnce(ChildStdout, Out) + Send>;

pub(super) struct Proc {
    pub pid: u32,
    pub stdin: SharedStdin,
    pub busy: Arc<AtomicBool>,
    events: Mutex<Receiver<DriverEvent>>,
    reaped: Arc<Exit>,
    piped_stdin: bool,
    ended: Mutex<Option<DriverEvent>>,
}

impl Proc {
    /// Start `program`. With `piped_stdin` the session keeps a pipe to it open until it ends.
    /// With a `reader`, standard output goes to it and the error stream is drained into the log;
    /// without, both go straight to the log. The session counts as busy from the start.
    pub(super) fn spawn(
        program: &Path,
        args: Vec<OsString>,
        spec: &StartSpec,
        piped_stdin: bool,
        reader: Option<Reader>,
    ) -> Result<Proc, AgboardError> {
        let failed = |reason: String| AgboardError::SessionLaunchFailed { reason };
        let log_file = spec
            .log
            .try_clone()
            .map_err(|e| failed(format!("Cannot write the session log: {e}.")))?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&spec.cwd)
            .stdin(if piped_stdin {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        if reader.is_some() {
            command.stdout(Stdio::piped()).stderr(Stdio::piped());
        } else {
            let again = || {
                log_file
                    .try_clone()
                    .map_err(|e| failed(format!("Cannot write the session log: {e}.")))
            };
            command
                .stdout(Stdio::from(again()?))
                .stderr(Stdio::from(again()?));
        }
        for (name, _) in std::env::vars_os() {
            if name.to_str().is_some_and(cli::scrubbed) {
                command.env_remove(&name);
            }
        }
        for (name, value) in &spec.env {
            command.env(name, value);
        }
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut command, 0);
        let mut child = command.spawn().map_err(|e| {
            failed(format!(
                "{} could not be started: {e}.",
                program
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ))
        })?;
        let pid = child.id();
        let log = Log(Arc::new(Mutex::new(log_file)));
        let stdin: SharedStdin = Arc::new(Mutex::new(child.stdin.take()));
        let busy = Arc::new(AtomicBool::new(true));
        let (tx, rx) = channel();
        let mut streams: Vec<Arc<Exit>> = Vec::new();
        if let (Some(read), Some(stdout)) = (reader, child.stdout.take()) {
            let done = Exit::new();
            streams.push(done.clone());
            let out = Out {
                events: tx.clone(),
                stdin: stdin.clone(),
                log: log.clone(),
                busy: busy.clone(),
            };
            std::thread::spawn(move || {
                read(stdout, out);
                done.finish();
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let done = Exit::new();
            streams.push(done.clone());
            let errlog = log.clone();
            std::thread::spawn(move || {
                for_each_line(stderr, MAX_LINE, |line| match line {
                    Line::Text(text) => errlog.line(text),
                    Line::TooLong => errlog.note("a line of the error stream was too long"),
                });
                done.finish();
            });
        }
        let reaped = Exit::new();
        let (mark, flag) = (reaped.clone(), busy.clone());
        std::thread::spawn(move || {
            let status = child.wait();
            mark.finish();
            for stream in &streams {
                stream.wait(STREAM_GRACE);
            }
            flag.store(false, Ordering::SeqCst);
            let (code, signal) = match status {
                Ok(status) => (status.code(), signal_of(&status)),
                Err(_) => (None, None),
            };
            let _ = tx.send(DriverEvent::Exited { code, signal });
        });
        Ok(Proc {
            pid,
            stdin,
            busy,
            events: Mutex::new(rx),
            reaped,
            piped_stdin,
            ended: Mutex::new(None),
        })
    }

    pub(super) fn next_event(&self) -> DriverEvent {
        if let Some(end) = self.ended.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            return end;
        }
        let event = self
            .events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .recv()
            .unwrap_or(DriverEvent::Exited {
                code: None,
                signal: None,
            });
        if matches!(event, DriverEvent::Exited { .. }) {
            *self.ended.lock().unwrap_or_else(|e| e.into_inner()) = Some(event.clone());
        }
        event
    }

    /// Close the input, SIGTERM the group after a moment, SIGKILL after `grace`. The child
    /// leaving is not the end: a command it started can stay in the group (and ignore SIGTERM),
    /// so the group is waited for as well.
    pub(super) fn stop(&self, grace: Duration) {
        if self.piped_stdin {
            self.stdin.lock().unwrap_or_else(|e| e.into_inner()).take();
            if self.reaped.wait(INPUT_GRACE.min(grace)) && !group_alive(self.pid) {
                return;
            }
        }
        signal_group(self.pid, false);
        let started = std::time::Instant::now();
        let reaped = self.reaped.wait(grace);
        if reaped && wait_group_gone(self.pid, grace.saturating_sub(started.elapsed())) {
            return;
        }
        if reaped {
            kill_members(self.pid);
        } else {
            signal_group(self.pid, true);
            self.reaped.wait(Duration::from_secs(2));
        }
        wait_group_gone(self.pid, Duration::from_secs(2));
    }
}

/// One line to the CLI. `Ok` also when the CLI is already gone: its exit is reported as an event.
pub(super) fn send_line(stdin: &SharedStdin, text: &str) -> Result<(), AgboardError> {
    let mut guard = stdin.lock().unwrap_or_else(|e| e.into_inner());
    let Some(pipe) = guard.as_mut() else {
        return Ok(());
    };
    let wrote = pipe
        .write_all(text.as_bytes())
        .and_then(|()| pipe.write_all(b"\n"))
        .and_then(|()| pipe.flush());
    if wrote.is_err() {
        guard.take();
    }
    Ok(())
}

#[cfg(unix)]
fn signal_of(status: &std::process::ExitStatus) -> Option<i32> {
    std::os::unix::process::ExitStatusExt::signal(status)
}

#[cfg(not(unix))]
fn signal_of(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}
