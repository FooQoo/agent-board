//! Local web server: API, SSE, delete protection, embedded assets.
//!
//! `run` builds its own tokio runtime; the rest of the CLI never starts one.
//! The server listens on 127.0.0.1 only and reads the shared files per request.

mod api;
pub mod assets;
pub mod dist;
mod events;
pub mod guard;
mod instance;
pub mod monitor;
pub mod remote;

use std::future::Future;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use tokio::sync::broadcast;

use crate::clock::format_utc;
use crate::error::AgboardError;
use crate::file_store::index::ProjectIndex;
use crate::file_store::watch::{Reloader, Watch};
use crate::paths::{self, ServeInfo};

/// How the web server is started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServeConfig {
    /// Port on 127.0.0.1. 0 lets the OS pick a free one.
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteServeConfig {
    pub port: u16,
    pub origins: Vec<String>,
}

/// State shared by all request handlers.
pub(crate) struct AppState {
    /// The port the server is really bound to (not the requested one).
    pub port: u16,
    /// Session token for browser deletes. Only `GET /` reveals it.
    pub token: String,
    /// The shared folder that holds every project's canonical files.
    pub shared: PathBuf,
    /// The index of the shared files, kept current by the watcher.
    pub index: Arc<RwLock<ProjectIndex>>,
    /// Queues a reload after a save made by this server or a notification.
    pub reloader: Reloader,
    /// Sends one unit when the catalog version changes; each SSE connection subscribes.
    pub changed: broadcast::Sender<()>,
}

/// Serve until Ctrl+C (or SIGTERM on Unix).
pub fn run(config: ServeConfig) -> Result<(), AgboardError> {
    run_until(config, termination_signal(), |_| {})
}

pub fn is_serving(info: &crate::paths::ServeInfo) -> bool {
    instance::is_serving(info)
}

/// Serve until `shutdown` completes. `on_ready` receives the bound address once
/// the server accepts connections.
pub fn run_until<F: Future<Output = ()>>(
    config: ServeConfig,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr),
) -> Result<(), AgboardError> {
    run_until_with_remote(config, None, shutdown, |addr, _| on_ready(addr))
}

/// Start the local board and, when configured, the dedicated reverse-proxy
/// listener. Both sockets are bound before the watcher or serve.json is started.
pub fn run_until_with_remote<F: Future<Output = ()>>(
    config: ServeConfig,
    remote: Option<RemoteServeConfig>,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr, Option<SocketAddr>),
) -> Result<(), AgboardError> {
    let serve_path = paths::serve_info_path();
    if let Some(info) = paths::read_serve_info()
        && instance::is_serving(&info)
    {
        return Err(AgboardError::AlreadyServing { port: info.port });
    }
    let _lifecycle = crate::lifecycle::LifecycleGuard::acquire(&paths::data_dir())?;
    let shared = paths::shared_dir();
    crate::file_store::io::remove_stale_temporaries(&shared, STALE_TEMPORARY_AGE);
    let listener = bind(config.port)?;
    let addr = listener
        .local_addr()
        .map_err(|_| port_in_use(config.port))?;
    let remote_listener = remote
        .as_ref()
        .map(|config| bind(config.port))
        .transpose()?;
    let remote_addr = remote_listener
        .as_ref()
        .and_then(|listener| listener.local_addr().ok());

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| internal(format!("Cannot start the server runtime: {e}")))?;
    runtime.block_on(async move {
        let listener = listener
            .set_nonblocking(true)
            .and_then(|()| tokio::net::TcpListener::from_std(listener))
            .map_err(|e| internal(format!("Cannot listen on {addr}: {e}")))?;
        let remote_listener = remote_listener
            .map(|listener| {
                listener.set_nonblocking(true).map_err(|e| {
                    internal(format!("Cannot listen on remote {remote_addr:?}: {e}"))
                })?;
                tokio::net::TcpListener::from_std(listener)
                    .map_err(|e| internal(format!("Cannot listen on remote {remote_addr:?}: {e}")))
            })
            .transpose()?;

        // The watch exists before the first read, so a change made during the
        // read is queued and read again.
        let index = Arc::new(RwLock::new(ProjectIndex::default()));
        let (changed, _) = broadcast::channel(16);
        let (_watch, reloader) = Watch::start(&shared, index.clone(), changed.clone())?;
        let state = Arc::new(AppState {
            port: addr.port(),
            token: assets::new_token()?,
            shared,
            index,
            reloader,
            changed,
        });
        let app = api::router(state.clone());
        let remote_app = match (&remote, remote_listener.as_ref(), remote_addr) {
            (Some(config), Some(_), Some(remote_addr)) => Some(remote::router(
                state.clone(),
                remote_addr.port(),
                &config.origins,
                assets::new_token()?,
            )?),
            (None, None, None) => None,
            _ => {
                return Err(internal(
                    "The remote listener address is unavailable.".into(),
                ));
            }
        };

        let pid = std::process::id();
        paths::write_serve_info(&ServeInfo {
            pid,
            port: addr.port(),
            started_at: format_utc(chrono::Utc::now()),
        });
        on_ready(addr, remote_addr);
        let result = tokio::select! {
            served = async { axum::serve(listener, app).await } => {
                served.map_err(|e| internal(format!("The server stopped: {e}")))
            }
            served = async {
                match (remote_listener, remote_app) {
                    (Some(listener), Some(app)) => axum::serve(listener, app).await
                        .map_err(|e| internal(format!("The remote server stopped: {e}"))),
                    (None, None) => std::future::pending::<Result<(), AgboardError>>().await,
                    _ => Err(internal("The remote listener is incomplete.".into())),
                }
            } => served,
            () = shutdown => Ok(()),
        };
        instance::remove_serve_info_of(&serve_path, pid);
        result
    })
}

fn internal(reason: String) -> AgboardError {
    AgboardError::DatabaseError { reason }
}

fn port_in_use(port: u16) -> AgboardError {
    AgboardError::PortInUse { port }
}

/// A temporary file or folder older than this is left over from a crash and is removed at startup.
const STALE_TEMPORARY_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Bind 127.0.0.1:`port`. Any failure to bind is reported as `PortInUse`.
fn bind(port: u16) -> Result<TcpListener, AgboardError> {
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
