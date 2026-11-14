//! The server another command started (`serve --auto`), and turning such a
//! server into a manual one with `serve -d`.

use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::interact::browser;
use crate::paths::{ServeInfo, ServeMode};
use crate::server::monitor_connection::lifecycle::MonitorEnv;
use crate::server::{self, BoardPages, Ended, IdleStop, MonitorOptions, idle};

/// How long `serve -d` waits for an automatic server to record that it is manual.
const SWITCH_TIMEOUT: Duration = Duration::from_secs(5);

/// How long a new automatic server waits for a board page that is already
/// open to reconnect before it opens one.
const OPEN_GRACE: Duration = Duration::from_secs(3);

/// Serve as a server another command started: prefer `AGBOARD_AUTOSTART_PORT`
/// (7420), and stop after `AGBOARD_IDLE_TIMEOUT` without use. The startup line
/// is JSON, for the command that waits for it; the command's lock is let go of
/// once the server is ready. With `open`, the project's board is opened in the
/// browser once, unless a board page connects within a short time.
pub fn run(open: Option<ProjectId>) -> Result<(), AgboardError> {
    let lock = crate::autostart::inherited_lock();
    let env = |name: &str| std::env::var(name).ok();
    let port = crate::autostart::preferred_port(&env);
    let idle_stop = IdleStop::from_env(&env);
    let ended = server::run_auto_until(
        port,
        idle_stop,
        MonitorOptions::new(MonitorEnv::from_process(), false),
        super::serve::shutdown_signal(),
        move |ready| {
            let mut line = json!({ "url": format!("http://127.0.0.1:{}/", ready.addr.port()) });
            if let Some(notice) = &ready.notice {
                eprintln!("{notice}");
                line["notice"] = json!(notice);
            }
            let mut stdout = std::io::stdout().lock();
            let _ = writeln!(stdout, "{line}");
            let _ = stdout.flush();
            drop(lock);
            if let Some(project) = open {
                let url = browser::board_url(ready.addr.port(), &project);
                let grace = open_grace(&env);
                std::thread::spawn(move || open_unless_connected(&url, &ready.board, grace));
            }
        },
    )?;
    if ended == Ended::Idle {
        eprintln!(
            "Stopped after {} without use.",
            idle::describe(idle_stop.timeout)
        );
    }
    Ok(())
}

/// The wait before opening: `AGBOARD_OPEN_GRACE_MS` for the tests, up to a
/// minute, or three seconds.
fn open_grace(env: &dyn Fn(&str) -> Option<String>) -> Duration {
    env("AGBOARD_OPEN_GRACE_MS")
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|ms| *ms <= 60_000)
        .map_or(OPEN_GRACE, Duration::from_millis)
}

/// After `grace`, open `url` unless a board page has connected meanwhile. The
/// outcome goes to `serve.log`.
fn open_unless_connected(url: &str, board: &BoardPages, grace: Duration) {
    std::thread::sleep(grace);
    if board.connected() {
        return;
    }
    match browser::opener(&|name| std::env::var(name).ok()) {
        Ok(opener) => match opener.open(url) {
            Ok(()) => eprintln!("Opened {url} in the browser."),
            Err(reason) => eprintln!("Could not open {url} in the browser. {reason}"),
        },
        Err(why) => eprintln!("Did not open {url} in the browser. {}", why.reason()),
    }
}

/// Whether `serve -d` with `port` and `monitor` asks for something the running
/// automatic server is not: another port, or a mobile monitor.
pub fn conflicts(port: Option<u16>, monitor: Option<&str>, info: &ServeInfo) -> bool {
    monitor.is_some() || port.is_some_and(|port| port != info.port)
}

/// Turn the running automatic server into a manual one, which no longer stops
/// by itself, and print the line `serve -d` prints. The server keeps running,
/// so the commands waiting on it stay connected.
pub fn switch_to_manual(data_dir: &Path, info: &ServeInfo, json: bool) -> Result<(), AgboardError> {
    let unavailable = |reason: String| AgboardError::BoardUnavailable { reason };
    let pid = libc::pid_t::try_from(info.pid)
        .map_err(|_| unavailable("serve.json has an invalid pid.".into()))?;
    // SAFETY: SIGUSR1 only tells the server to stop counting idle time.
    if unsafe { libc::kill(pid, libc::SIGUSR1) } != 0 {
        return Err(unavailable(format!(
            "Cannot signal the server (pid {}): {}.",
            info.pid,
            std::io::Error::last_os_error()
        )));
    }
    let deadline = Instant::now() + SWITCH_TIMEOUT;
    while crate::paths::read_serve_info_in(data_dir)
        .is_some_and(|now| now.pid == info.pid && now.mode == ServeMode::Auto)
    {
        if Instant::now() >= deadline {
            return Err(unavailable(format!(
                "The server (pid {}) did not switch to manual within {} seconds.",
                info.pid,
                SWITCH_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    crate::autostart::resume(data_dir);
    let startup = json!({ "url": format!("http://127.0.0.1:{}/", info.port) });
    let line = super::serve::daemon_line(startup, info.pid, &data_dir.join("serve.log"), json);
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auto_on(port: u16) -> ServeInfo {
        ServeInfo {
            pid: 41235,
            port,
            started_at: "2026-11-14T03:00:00Z".into(),
            mode: ServeMode::Auto,
            idle_timeout_seconds: Some(1800),
        }
    }

    #[test]
    fn the_wait_before_opening_comes_from_the_environment() {
        let with = |value: &'static str| {
            open_grace(&move |name| (name == "AGBOARD_OPEN_GRACE_MS").then(|| value.into()))
        };
        assert_eq!(open_grace(&|_| None), Duration::from_secs(3));
        assert_eq!(with("200"), Duration::from_millis(200));
        assert_eq!(with("0"), Duration::ZERO);
        assert_eq!(with("60001"), Duration::from_secs(3));
        assert_eq!(with("soon"), Duration::from_secs(3));
    }

    #[test]
    fn serve_d_switches_unless_it_asks_for_another_port_or_a_monitor() {
        let info = auto_on(52114);
        assert!(!conflicts(None, None, &info));
        assert!(!conflicts(Some(52114), None, &info));
        assert!(conflicts(Some(7420), None, &info));
        assert!(conflicts(None, Some("ngrok"), &info));
    }
}
