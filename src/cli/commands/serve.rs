use std::io::Write;
use std::net::SocketAddr;

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
    let explicit = validate_monitor_args(args, &|name| std::env::var(name).ok())?;
    server::run_until_with_monitor(
        ServeConfig { port: args.port },
        MonitorOptions::new(MonitorEnv::from_process(), explicit),
        shutdown_signal(),
        |addr, monitor| announce(addr, monitor, json),
    )
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
