//! Starting the one shared server of a data directory when a command needs it.
//!
//! A command that cannot work without a server (a wait, a question that waits
//! for its answer) starts one and waits until it accepts connections. The agent
//! hook starts one without waiting. Every other command works on the files
//! alone and starts nothing. A server started this way stops by itself after it
//! has gone unused (see `server::idle`).
//!
//! `AGBOARD_AUTOSTART=0` turns all of this off. Only the real command line
//! allows it at all: the library embedded in a test never starts a server.

mod spawn;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::lock::AutostartLock;
use crate::lifecycle::LifecycleGuard;
use crate::paths::{self, ServeInfo};
use crate::server::{bind, idle, instance};

pub use spawn::inherited_lock;

/// The port an automatic server tries first.
pub const DEFAULT_PORT: u16 = 7420;

/// How long a command waits for another command that is starting the server.
const LOCK_WAIT: Duration = Duration::from_secs(40);

/// How long a started server may take to accept connections.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a server that holds the data directory but does not answer gets,
/// in case it is starting or shutting down.
const SETTLE_WAIT: Duration = Duration::from_secs(10);

/// The marker `agboard stop` leaves so that the hook does not start the server again.
const PAUSED: &str = "autostart.paused";

static ALLOWED: AtomicBool = AtomicBool::new(false);

/// Let this process start servers. Called once by the `agboard` command line.
pub fn allow_in_this_process() {
    ALLOWED.store(true, Ordering::SeqCst);
}

/// Whether this process is the `agboard` command line, not the library
/// embedded in a test.
pub fn in_command_line() -> bool {
    ALLOWED.load(Ordering::SeqCst)
}

/// Whether a command may start a server: only in the `agboard` command line,
/// and not with `AGBOARD_AUTOSTART=0`.
pub fn enabled() -> bool {
    in_command_line()
        && std::env::var("AGBOARD_AUTOSTART").map_or(true, |value| value.trim() != "0")
}

/// The port an automatic server tries first: `AGBOARD_AUTOSTART_PORT`, or 7420.
/// Port 0 lets the OS choose, which is what the tests use.
pub fn preferred_port(env: &dyn Fn(&str) -> Option<String>) -> u16 {
    env("AGBOARD_AUTOSTART_PORT")
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Keep the hook from starting a server until a command that waits, `serve`
/// or `serve -d` starts one. Called by `agboard stop`.
pub fn pause(data_dir: &Path) {
    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(data_dir.join(PAUSED), b"");
}

/// Remove the marker that [`pause`] left.
pub fn resume(data_dir: &Path) {
    let _ = std::fs::remove_file(data_dir.join(PAUSED));
}

pub fn is_paused(data_dir: &Path) -> bool {
    data_dir.join(PAUSED).exists()
}

/// The running server of `data_dir`, started now if there is none. Returns
/// once it accepts connections. One line on standard error says when a server
/// was started; standard output stays the command's own. A server started now
/// opens the board of `open` in the browser, unless a board page connects.
pub fn ensure_serving(
    data_dir: &Path,
    open: Option<&ProjectId>,
) -> Result<ServeInfo, AgboardError> {
    if let Some(info) = running(data_dir)? {
        return Ok(info);
    }
    let lock = AutostartLock::acquire_waiting(data_dir, LOCK_WAIT)?;
    // Another command may have started it while this one waited.
    if let Some(info) = running(data_dir)? {
        return Ok(info);
    }
    resume(data_dir);
    let log = data_dir.join("serve.log");
    let mut child = spawn::spawn_server(data_dir, &log, &lock, open)?;
    let outcome = spawn::wait_ready(&mut child, &log, READY_TIMEOUT);
    drop(lock);
    match outcome {
        Ok(startup) => {
            let info = paths::read_serve_info_in(data_dir).ok_or_else(|| {
                unavailable(format!(
                    "The background server started but wrote no serve.json. See {}.",
                    log.display()
                ))
            })?;
            let minutes = idle::describe(Duration::from_secs(
                info.idle_timeout_seconds
                    .unwrap_or(idle::DEFAULT_IDLE_TIMEOUT.as_secs()),
            ));
            if let Some(notice) = startup.notice {
                eprintln!("{notice}");
            }
            eprintln!(
                "Started the Agent Board server at http://127.0.0.1:{}/ in the background. It stops by itself after {minutes} without use.",
                info.port
            );
            Ok(info)
        }
        // Another server won the data directory: use it.
        Err(spawn::Failure::Exited {
            code: Some(code), ..
        }) if code == "already_serving" || code == "database_busy" => wait_for_other(data_dir)
            .ok_or_else(|| {
                unavailable(format!(
                    "Another server holds the data directory but does not answer. See {}.",
                    log.display()
                ))
            }),
        Err(failure) => Err(failure.into_error(&log)),
    }
}

/// Start the server in the background without waiting, for the agent hook.
/// Nothing happens when a server process is alive, after `agboard stop`, or
/// while another command is starting one. Failures are left in `serve.log`.
/// The server opens the board of `open` as [`ensure_serving`] does.
pub fn start_in_background(data_dir: &Path, open: Option<&ProjectId>) {
    if !enabled() || is_paused(data_dir) || process_named(data_dir) {
        return;
    }
    let Some(lock) = AutostartLock::try_acquire(data_dir) else {
        return;
    };
    if process_named(data_dir) {
        return;
    }
    // The child keeps the lock until it is ready, so nobody starts a second one meanwhile.
    let _ = spawn::spawn_server(data_dir, &data_dir.join("serve.log"), &lock, open);
}

/// Whether `serve.json` names a process that is alive. Reads one file and
/// sends signal 0: no network, so the hook stays fast.
fn process_named(data_dir: &Path) -> bool {
    paths::read_serve_info_in(data_dir).is_some_and(|info| instance::process_alive(info.pid))
}

/// The server `serve.json` names, if it answers. A process that is alive and
/// holds the data directory but does not answer is never replaced by a second
/// server: it is reported, after a short wait in case it is starting or
/// stopping.
fn running(data_dir: &Path) -> Result<Option<ServeInfo>, AgboardError> {
    let Some(info) = paths::read_serve_info_in(data_dir) else {
        return Ok(None);
    };
    if instance::is_serving(&info) {
        return Ok(Some(info));
    }
    if connection_denied(info.port) {
        return Err(AgboardError::LocalNetworkDenied);
    }
    let deadline = Instant::now() + SETTLE_WAIT;
    loop {
        let Some(info) = paths::read_serve_info_in(data_dir) else {
            return Ok(None);
        };
        if instance::is_serving(&info) {
            return Ok(Some(info));
        }
        if !instance::process_alive(info.pid) || lifecycle_free(data_dir) {
            return Ok(None);
        }
        if Instant::now() >= deadline {
            return Err(unavailable(format!(
                "The server (pid {}) is not answering. Stop it with \"agboard stop\" and try again.",
                info.pid
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Wait for the server another command started to accept connections.
fn wait_for_other(data_dir: &Path) -> Option<ServeInfo> {
    let deadline = Instant::now() + SETTLE_WAIT;
    loop {
        if let Some(info) = paths::read_serve_info_in(data_dir).filter(instance::is_serving) {
            return Some(info);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Whether no server holds the data directory. The lock is only looked at.
fn lifecycle_free(data_dir: &Path) -> bool {
    LifecycleGuard::acquire(data_dir).is_ok()
}

/// Whether the OS or a sandbox refuses a connection to 127.0.0.1:`port`.
pub(crate) fn connection_denied(port: u16) -> bool {
    let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500))
        .err()
        .is_some_and(|error| bind::is_denied(&error))
}

fn unavailable(reason: String) -> AgboardError {
    AgboardError::BoardUnavailable { reason }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_preferred_port_comes_from_the_environment() {
        assert_eq!(preferred_port(&|_| None), 7420);
        let with = |value: &'static str| {
            preferred_port(&move |name| (name == "AGBOARD_AUTOSTART_PORT").then(|| value.into()))
        };
        assert_eq!(with("0"), 0);
        assert_eq!(with("7661"), 7661);
        assert_eq!(with("not a port"), 7420);
        assert_eq!(with("70000"), 7420);
    }

    #[test]
    fn stop_leaves_a_marker_that_a_start_removes() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_paused(dir.path()));
        pause(dir.path());
        assert!(is_paused(dir.path()));
        resume(dir.path());
        assert!(!is_paused(dir.path()));
        resume(dir.path());
    }

    #[test]
    fn the_library_never_starts_a_server_by_itself() {
        // Only `cli::run` allows it; tests embed the library.
        assert!(!enabled());
        let dir = tempfile::tempdir().unwrap();
        start_in_background(dir.path(), None);
        assert!(!dir.path().join("serve.log").exists());
    }

    #[test]
    fn a_stale_serve_json_means_no_server() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(running(dir.path()).unwrap(), None);
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        paths::write_serve_info_in(
            dir.path(),
            &ServeInfo {
                pid,
                port: 1,
                started_at: "2026-11-14T03:00:00Z".into(),
                mode: paths::ServeMode::Auto,
                idle_timeout_seconds: Some(1800),
            },
        );
        assert_eq!(running(dir.path()).unwrap(), None);
    }
}
