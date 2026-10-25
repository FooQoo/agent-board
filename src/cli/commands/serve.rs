use std::io::Write;
use std::net::SocketAddr;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::cli::args::{ServeArgs, validate_monitor_args};
use crate::error::AgboardError;
use crate::server::monitor_connection::lifecycle::MonitorEnv;
use crate::server::{self, MonitorOptions, MonitorReady, ServeConfig};

/// Serve the board until Ctrl+C (or SIGTERM), then return.
///
/// The startup line goes straight to standard output from `on_ready`, so it
/// appears only once the port is bound; `execute` prints nothing for `serve`
/// afterwards. The command works on the whole data area, never on one project
/// or task, and changes nothing that needs a notification.
pub fn run(json: bool, args: &ServeArgs) -> Result<(), AgboardError> {
    if args.daemon {
        return daemonize(json, args);
    }
    let explicit = validate_monitor_args(args, &|name| std::env::var(name).ok())?;
    server::run_until_with_monitor(
        ServeConfig { port: args.port },
        MonitorOptions::new(MonitorEnv::from_process(), explicit),
        shutdown_signal(),
        |addr, monitor| announce(addr, monitor, json),
    )
}

/// How long `serve -d` waits for the background server to report it is ready.
/// An ngrok connection can take a while to open.
const DAEMON_READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Start `agboard serve` again as a detached process and return once its
/// startup line is in the log, so the caller sees the same address and
/// passcode a foreground `serve` prints.
///
/// The log is truncated on every start and readable only by the user, because
/// the startup line carries the phone passcode.
fn daemonize(json: bool, args: &ServeArgs) -> Result<(), AgboardError> {
    // Fail on a bad `--monitor` here, with the usual message, not in the log.
    validate_monitor_args(args, &|name| std::env::var(name).ok())?;
    let data_dir = crate::paths::data_dir()?;
    if let Some(info) = crate::paths::read_serve_info_in(&data_dir)
        && server::is_serving(&info)
    {
        return Err(AgboardError::AlreadyServing { port: info.port });
    }
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| unavailable(format!("Cannot create the data directory: {e}")))?;
    let log_path = data_dir.join("serve.log");
    let log = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&log_path)
        .map_err(|e| unavailable(format!("Cannot open serve.log: {e}")))?;
    let log_err = log
        .try_clone()
        .map_err(|e| unavailable(format!("Cannot open serve.log: {e}")))?;
    let exe = std::env::current_exe()
        .map_err(|e| unavailable(format!("Cannot find the agboard executable: {e}")))?;

    let mut command = process::Command::new(exe);
    // The startup line is the handshake, so the child always prints JSON.
    command.args(["--json", "serve", "--port", &args.port.to_string()]);
    if let Some(mode) = &args.monitor {
        command.args(["--monitor", mode]);
    }
    command
        .stdin(process::Stdio::null())
        .stdout(log)
        .stderr(log_err);
    // SAFETY: setsid is async-signal-safe and only detaches the child from the
    // terminal's session and process group, so closing the terminal cannot stop it.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command
        .spawn()
        .map_err(|e| unavailable(format!("Cannot start the background server: {e}")))?;

    let deadline = Instant::now() + DAEMON_READY_TIMEOUT;
    loop {
        let text = std::fs::read_to_string(&log_path).unwrap_or_default();
        if let Some(line) = text.lines().next().filter(|_| text.contains('\n'))
            && let Ok(value) = serde_json::from_str::<serde_json::Value>(line)
            && value.get("url").is_some()
        {
            let mut stdout = std::io::stdout().lock();
            let _ = writeln!(
                stdout,
                "{}",
                daemon_line(value, child.id(), &log_path, json)
            );
            let _ = stdout.flush();
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(unavailable(format!(
                "The background server exited ({status}) before it was ready: {}",
                text.trim()
            )));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err(unavailable(format!(
                "The background server was not ready within {} seconds. See {}.",
                DAEMON_READY_TIMEOUT.as_secs(),
                log_path.display()
            )));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn unavailable(reason: String) -> AgboardError {
    AgboardError::BoardUnavailable { reason }
}

/// The line `serve -d` prints: the child's startup object with the process and
/// log added, or the usual sentence with the way to stop it.
fn daemon_line(mut startup: serde_json::Value, pid: u32, log: &Path, json: bool) -> String {
    if json {
        startup["pid"] = json!(pid);
        startup["log"] = json!(log.display().to_string());
        return startup.to_string();
    }
    let mut line = format!("Serving at {}", startup["url"].as_str().unwrap_or_default());
    if let Some(ngrok) = startup.get("monitor").and_then(|m| m.get("ngrok")) {
        line.push_str(&format!(
            "; mobile monitor at {} with passcode {}",
            ngrok["url"].as_str().unwrap_or_default(),
            ngrok["passcode"].as_str().unwrap_or_default()
        ));
    }
    line.push_str(&format!(
        " in the background (pid {pid}, log {}; stop with \"agboard stop\")",
        log.display()
    ));
    line
}

/// Write the startup line (or, with `--json`, the URL object) and flush, so a
/// reader on a pipe sees it before the server starts waiting.
fn announce(addr: SocketAddr, monitor: Option<MonitorReady>, json: bool) {
    let line = startup_line(addr, monitor.as_ref(), json);
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}

/// The startup line. The phone passcode of a mobile monitor is on it, because
/// this is the one place the person who started `serve` is sure to look.
fn startup_line(addr: SocketAddr, monitor: Option<&MonitorReady>, json: bool) -> String {
    let url = format!("http://127.0.0.1:{}/", addr.port());
    if json {
        let mut value = json!({ "url": url });
        if let Some(monitor) = monitor {
            value["monitor"] = json!({
                "mode": "ngrok",
                "ngrok": {
                    "url": monitor.url,
                    "status": "ready",
                    "passcode": monitor.passcode.expose()
                }
            });
        }
        value.to_string()
    } else {
        let mut line = format!("Serving at {url}");
        if let Some(monitor) = monitor {
            line.push_str(&format!(
                "; mobile monitor at {} with passcode {}",
                monitor.url,
                monitor.passcode.expose()
            ));
        }
        line.push_str(" (press Ctrl+C to stop)");
        line
    }
}

/// Completes on Ctrl+C, or on SIGTERM where the platform has it.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {}
                    _ = term.recv() => {}
                }
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::monitor_auth::passcode::Passcode;

    fn addr() -> SocketAddr {
        "127.0.0.1:7461".parse().unwrap()
    }

    fn ready() -> MonitorReady {
        MonitorReady {
            url: "https://abc.ngrok.app".into(),
            passcode: Passcode::from_number(37),
        }
    }

    #[test]
    fn the_daemon_line_names_the_way_to_stop_it() {
        let startup = json!({"url": "http://127.0.0.1:7461/"});
        let log = Path::new("/data/serve.log");
        assert_eq!(
            daemon_line(startup.clone(), 42, log, false),
            "Serving at http://127.0.0.1:7461/ in the background (pid 42, log /data/serve.log; stop with \"agboard stop\")"
        );
        let value: serde_json::Value =
            serde_json::from_str(&daemon_line(startup, 42, log, true)).unwrap();
        assert_eq!(value["pid"], 42);
        assert_eq!(value["log"], "/data/serve.log");
    }

    #[test]
    fn a_plain_serve_line_has_no_monitor_part() {
        assert_eq!(
            startup_line(addr(), None, false),
            "Serving at http://127.0.0.1:7461/ (press Ctrl+C to stop)"
        );
        assert_eq!(
            startup_line(addr(), None, true),
            r#"{"url":"http://127.0.0.1:7461/"}"#
        );
    }

    #[test]
    fn the_monitor_line_shows_the_url_and_the_four_digit_passcode() {
        assert_eq!(
            startup_line(addr(), Some(&ready()), false),
            "Serving at http://127.0.0.1:7461/; mobile monitor at https://abc.ngrok.app with passcode 0037 (press Ctrl+C to stop)"
        );
    }

    #[test]
    fn the_json_line_carries_the_passcode_under_the_ngrok_monitor() {
        let value: serde_json::Value =
            serde_json::from_str(&startup_line(addr(), Some(&ready()), true)).unwrap();
        assert_eq!(value["url"], "http://127.0.0.1:7461/");
        assert_eq!(
            value["monitor"],
            json!({"mode": "ngrok", "ngrok": {
                "url": "https://abc.ngrok.app",
                "status": "ready",
                "passcode": "0037"
            }})
        );
    }
}
