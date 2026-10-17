use std::io::Write;
use std::net::SocketAddr;

use serde_json::json;

use crate::cli::args::ServeArgs;
use crate::error::AgboardError;
use crate::server::{self, ServeConfig};

/// Serve the board until Ctrl+C (or SIGTERM), then return.
///
/// The startup line goes straight to standard output from `on_ready`, so it
/// appears only once the port is bound; `execute` prints nothing for `serve`
/// afterwards. The command works on the whole data area, never on one project
/// or task, and changes nothing that needs a notification.
pub fn run(json: bool, args: &ServeArgs) -> Result<(), AgboardError> {
    let remote = args.remote_port.map(|port| server::RemoteServeConfig {
        port,
        origins: args.remote_origins.clone(),
    });
    server::run_until_with_remote(
        ServeConfig { port: args.port },
        remote,
        shutdown_signal(),
        |addr, remote_addr| announce(addr, remote_addr, json),
    )
}

/// Write the startup line (or, with `--json`, the URL object) and flush, so a
/// reader on a pipe sees it before the server starts waiting.
fn announce(addr: SocketAddr, remote_addr: Option<SocketAddr>, json: bool) {
    let url = format!("http://127.0.0.1:{}/", addr.port());
    let remote_url = remote_addr.map(|addr| format!("http://127.0.0.1:{}/", addr.port()));
    let line = if json {
        match remote_url {
            Some(remote_url) => json!({ "url": url, "remoteUrl": remote_url }).to_string(),
            None => json!({ "url": url }).to_string(),
        }
    } else {
        match remote_url {
            Some(remote_url) => format!(
                "Serving at {url}; remote proxy entry at {remote_url} (press Ctrl+C to stop)"
            ),
            None => format!("Serving at {url} (press Ctrl+C to stop)"),
        }
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
