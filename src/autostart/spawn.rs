//! Starting `agboard serve --auto` as a detached process and reading its
//! startup line from `serve.log`.
//!
//! The child inherits the open `autostart.lock` and lets go of it once it is
//! ready (or exits), so no other command starts a second server meanwhile, even
//! when the command that started it does not wait.

use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{self, Child};
use std::time::{Duration, Instant};

use crate::error::{AgboardError, PortHolder};
use crate::file_store::lock::AutostartLock;

/// The variable that tells the child which descriptor holds `autostart.lock`.
const LOCK_FD: &str = "AGBOARD_AUTOSTART_LOCK_FD";

/// What the child said once it was ready.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Startup {
    /// Why it listens on another port than it preferred.
    pub notice: Option<String>,
}

/// Why the child did not become ready.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Failure {
    /// It ended first; the error it printed, if any.
    Exited {
        code: Option<String>,
        reason: String,
    },
    /// It did not say it was ready in time.
    Timeout,
}

impl Failure {
    /// The error the command reports. A refusal to use the local network and a
    /// taken port keep their codes; everything else is `board_unavailable`
    /// with the log to read.
    pub(super) fn into_error(self, log: &Path) -> AgboardError {
        match self {
            Failure::Exited {
                code: Some(code), ..
            } if code == "local_network_denied" => AgboardError::LocalNetworkDenied,
            Failure::Exited {
                code: Some(code), ..
            } if code == "port_in_use" => AgboardError::PortInUse {
                port: super::DEFAULT_PORT,
                holder: PortHolder::Unknown,
            },
            Failure::Exited { code, reason } => {
                let reason = reason.trim().trim_end_matches('.');
                let detail = if reason.is_empty() {
                    String::new()
                } else {
                    format!(": {reason}")
                };
                AgboardError::BoardUnavailable {
                    reason: format!(
                        "The background server could not start ({}){detail}. See {}.",
                        code.as_deref().unwrap_or("no error was printed"),
                        log.display()
                    ),
                }
            }
            Failure::Timeout => AgboardError::BoardUnavailable {
                reason: format!(
                    "The background server was not ready within {} seconds. See {}.",
                    super::READY_TIMEOUT.as_secs(),
                    log.display()
                ),
            },
        }
    }
}

/// Start `agboard serve --auto` for `data_dir`, detached from the terminal,
/// working in the data directory, with its output in `log` (truncated, and
/// readable only by the user). The child holds `lock` until it is ready.
pub(super) fn spawn_server(
    data_dir: &Path,
    log: &Path,
    lock: &AutostartLock,
) -> Result<Child, AgboardError> {
    let unavailable = |what: &str, e: std::io::Error| AgboardError::BoardUnavailable {
        reason: format!("{what}: {e}."),
    };
    std::fs::create_dir_all(data_dir)
        .map_err(|e| unavailable("Cannot create the data directory", e))?;
    let out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(log)
        .map_err(|e| unavailable("Cannot open serve.log", e))?;
    let err = out
        .try_clone()
        .map_err(|e| unavailable("Cannot open serve.log", e))?;
    let exe = std::env::current_exe()
        .map_err(|e| unavailable("Cannot find the agboard executable", e))?;
    let fd = lock.file().as_raw_fd();
    let mut command = process::Command::new(exe);
    command
        .args(["--json", "serve", "--auto"])
        .current_dir(data_dir)
        .env(LOCK_FD, fd.to_string())
        .stdin(process::Stdio::null())
        .stdout(out)
        .stderr(err);
    // SAFETY: setsid and fcntl are async-signal-safe. setsid detaches the child
    // from the terminal's session, so closing the terminal cannot stop it;
    // clearing close-on-exec hands the lock descriptor to the child.
    unsafe {
        command.pre_exec(move || {
            if libc::setsid() == -1 || libc::fcntl(fd, libc::F_SETFD, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command
        .spawn()
        .map_err(|e| unavailable("Cannot start the background server", e))
}

/// The `autostart.lock` handed over by the command that started this server,
/// marked close-on-exec so that no process this server starts keeps it. Drop
/// it once the server is ready.
pub fn inherited_lock() -> Option<File> {
    let fd: RawFd = std::env::var(LOCK_FD).ok()?.parse().ok()?;
    // SAFETY: F_GETFD only reads the descriptor's flags; -1 means it is not open.
    if fd < 3 || unsafe { libc::fcntl(fd, libc::F_GETFD) } == -1 {
        return None;
    }
    // SAFETY: as above; setting FD_CLOEXEC changes no data.
    unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    // SAFETY: the descriptor is open, was inherited for this purpose, and is owned by nothing else here.
    Some(unsafe { File::from_raw_fd(fd) })
}

/// Wait until the child's startup line is in `log`, the child ends, or
/// `timeout` passes. A child that is too slow is killed.
pub(super) fn wait_ready(
    child: &mut Child,
    log: &Path,
    timeout: Duration,
) -> Result<Startup, Failure> {
    let deadline = Instant::now() + timeout;
    loop {
        let text = std::fs::read_to_string(log).unwrap_or_default();
        if let Some(startup) = startup_of(&text) {
            return Ok(startup);
        }
        if let Ok(Some(_)) = child.try_wait() {
            let text = std::fs::read_to_string(log).unwrap_or_default();
            if let Some(startup) = startup_of(&text) {
                return Ok(startup);
            }
            return Err(exit_of(&text));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Failure::Timeout);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// The startup line among the complete lines of the log.
fn startup_of(text: &str) -> Option<Startup> {
    complete_lines(text).find_map(|value| {
        value.get("url")?;
        Some(Startup {
            notice: value
                .get("notice")
                .and_then(|n| n.as_str())
                .map(str::to_string),
        })
    })
}

/// The error the child printed, or its whole output when it printed none.
fn exit_of(text: &str) -> Failure {
    let printed = complete_lines(text).find_map(|value| {
        let error = value.get("error")?;
        Some((
            error.get("code")?.as_str()?.to_string(),
            error
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or_default()
                .to_string(),
        ))
    });
    match printed {
        Some((code, reason)) => Failure::Exited {
            code: Some(code),
            reason,
        },
        None => Failure::Exited {
            code: None,
            reason: text.trim().to_string(),
        },
    }
}

fn complete_lines(text: &str) -> impl Iterator<Item = serde_json::Value> + '_ {
    let complete = text.rfind('\n').map_or("", |end| &text[..end]);
    complete
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_startup_line_is_found_only_when_it_is_complete() {
        assert_eq!(startup_of(r#"{"url":"http://127.0.0.1:7661/"}"#), None);
        assert_eq!(
            startup_of("{\"url\":\"http://127.0.0.1:7661/\"}\n"),
            Some(Startup::default())
        );
        let noted = "{\"url\":\"http://127.0.0.1:52114/\",\"notice\":\"Port 7420 is used by another program, so this server uses port 52114.\"}\n";
        assert_eq!(
            startup_of(noted).unwrap().notice.unwrap(),
            "Port 7420 is used by another program, so this server uses port 52114."
        );
    }

    #[test]
    fn the_childs_error_keeps_its_code() {
        let text =
            "{\"error\":{\"code\":\"local_network_denied\",\"message\":\"m\",\"reason\":\"r\"}}\n";
        let failure = exit_of(text);
        assert_eq!(
            failure,
            Failure::Exited {
                code: Some("local_network_denied".into()),
                reason: "r".into()
            }
        );
        let log = Path::new("serve.log");
        assert_eq!(failure.into_error(log), AgboardError::LocalNetworkDenied);
        assert_eq!(
            exit_of("{\"error\":{\"code\":\"port_in_use\",\"reason\":\"x\"}}\n")
                .into_error(log)
                .code(),
            "port_in_use"
        );
    }

    #[test]
    fn other_failures_are_board_unavailable_with_the_log() {
        let log = Path::new("serve.log");
        let busy = exit_of("{\"error\":{\"code\":\"database_error\",\"reason\":\"Disk full.\"}}\n")
            .into_error(log);
        assert_eq!(busy.code(), "board_unavailable");
        assert_eq!(
            busy.reason(),
            "The background server could not start (database_error): Disk full. See serve.log."
        );
        let silent = exit_of("").into_error(log);
        assert!(
            silent.reason().contains("no error was printed"),
            "{}",
            silent.reason()
        );
        assert!(
            Failure::Timeout
                .into_error(log)
                .reason()
                .contains("30 seconds")
        );
    }
}
