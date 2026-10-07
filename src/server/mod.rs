//! Local web server: API, SSE, delete protection, embedded assets.
//!
//! `run` builds its own tokio runtime; the rest of the CLI never starts one.
//! The server listens on 127.0.0.1 only and opens the database per request.

mod api;
pub mod assets;
pub mod dist;
mod events;
pub mod guard;
mod instance;

use std::future::Future;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::clock::format_utc;
use crate::error::SkanError;
use crate::paths::{self, ServeInfo};
use crate::store::ProjectStore;

/// How the web server is started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServeConfig {
    /// Port on 127.0.0.1. 0 lets the OS pick a free one.
    pub port: u16,
}

/// State shared by all request handlers.
pub(crate) struct AppState {
    /// The port the server is really bound to (not the requested one).
    pub port: u16,
    /// Session token for browser deletes. Only `GET /` reveals it.
    pub token: String,
    pub db_path: PathBuf,
    /// Sends one unit per change; each SSE connection subscribes.
    pub changed: broadcast::Sender<()>,
}

/// Serve until Ctrl+C (or SIGTERM on Unix).
pub fn run(config: ServeConfig) -> Result<(), SkanError> {
    run_until(config, termination_signal(), |_| {})
}

/// Serve until `shutdown` completes. `on_ready` receives the bound address once
/// the server accepts connections.
pub fn run_until<F: Future<Output = ()>>(
    config: ServeConfig,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr),
) -> Result<(), SkanError> {
    let db_path = paths::db_path();
    let serve_path = paths::serve_info_path();
    open_database(&db_path)?;
    if let Some(info) = paths::read_serve_info()
        && instance::is_serving(&info)
    {
        return Err(SkanError::AlreadyServing { port: info.port });
    }
    let listener = bind(config.port)?;
    let addr = listener
        .local_addr()
        .map_err(|_| port_in_use(config.port))?;

    let (changed, _) = broadcast::channel(16);
    let state = Arc::new(AppState {
        port: addr.port(),
        token: assets::new_token()?,
        db_path,
        changed,
    });
    let app = api::router(state);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| internal(format!("Cannot start the server runtime: {e}")))?;
    runtime.block_on(async move {
        let listener = listener
            .set_nonblocking(true)
            .and_then(|()| tokio::net::TcpListener::from_std(listener))
            .map_err(|e| internal(format!("Cannot listen on {addr}: {e}")))?;
        let pid = std::process::id();
        paths::write_serve_info(&ServeInfo {
            pid,
            port: addr.port(),
            started_at: format_utc(chrono::Utc::now()),
        });
        on_ready(addr);
        let result = tokio::select! {
            served = async { axum::serve(listener, app).await } => {
                served.map_err(|e| internal(format!("The server stopped: {e}")))
            }
            () = shutdown => Ok(()),
        };
        instance::remove_serve_info_of(&serve_path, pid);
        result
    })
}

fn internal(reason: String) -> SkanError {
    SkanError::DatabaseError { reason }
}

fn port_in_use(port: u16) -> SkanError {
    SkanError::PortInUse { port }
}

/// Open the database once before serving, so a database that cannot be used
/// (another schema, a corrupt file) stops the server at startup. A new data
/// area gets an empty catalog; serving needs no project.
fn open_database(db_path: &std::path::Path) -> Result<(), SkanError> {
    ProjectStore::open(db_path).map(|_| ())
}

/// Bind 127.0.0.1:`port`. Any failure to bind is reported as `PortInUse`.
fn bind(port: u16) -> Result<TcpListener, SkanError> {
    TcpListener::bind(("127.0.0.1", port)).map_err(|_| port_in_use(port))
}

/// Completes on Ctrl+C, or on SIGTERM where the platform has it.
async fn termination_signal() {
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
