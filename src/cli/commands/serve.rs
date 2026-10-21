use std::io::Write;
use std::net::SocketAddr;

use serde_json::json;

use crate::cli::args::{ServeArgs, validate_monitor_args};
use crate::error::AgboardError;
use crate::server::monitor_connection::lifecycle::{MonitorEnv, Overrides};
use crate::server::{self, MonitorOptions, MonitorReady, ServeConfig};

/// Serve the board until Ctrl+C (or SIGTERM), then return.
///
/// The startup line goes straight to standard output from `on_ready`, so it
/// appears only once the port is bound; `execute` prints nothing for `serve`
/// afterwards. The command works on the whole data area, never on one project
/// or task, and changes nothing that needs a notification.
pub fn run(json: bool, args: &ServeArgs) -> Result<(), AgboardError> {
    let explicit =
        validate_monitor_args(args, &|name| std::env::var(name).ok())?.map(|request| Overrides {
            allow_emails: request.allow_emails,
            domain: request.domain,
            oauth_app: request.oauth_app,
        });
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
    let url = format!("http://127.0.0.1:{}/", addr.port());
    let line = if json {
        let mut value = json!({ "url": url });
        if let Some(monitor) = &monitor {
            value["monitor"] = json!({
                "mode": "ngrok",
                "ngrok": { "url": monitor.url, "status": "ready" }
            });
        }
        value.to_string()
    } else {
        let mut line = format!("Serving at {url}");
        if let Some(monitor) = &monitor {
            line.push_str(&format!("; mobile monitor at {}", monitor.url));
        }
        line.push_str(" (press Ctrl+C to stop)");
        line
    };
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
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
