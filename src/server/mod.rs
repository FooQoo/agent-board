//! Local web server: API, SSE, delete protection, embedded assets.
//!
//! `run_until_with_monitor` builds its own tokio runtime; the rest of the CLI never starts one.
//! The server listens on 127.0.0.1 only and reads the shared files per request.

mod acceptance;
mod api;
pub mod assets;
pub(crate) mod bind;
pub(crate) mod change_feed;
pub mod contracts;
pub mod dist;
mod events;
pub mod guard;
pub mod idle;
pub(crate) mod instance;
mod launch;
mod messages;
mod messages_send;
pub(crate) mod preferences;
mod pwa;
pub mod monitor_auth {
    pub mod contracts;
    pub mod guard;
    pub mod passcode;
    pub mod session;
}
pub mod monitor_connection;
mod request;
pub mod resident;
mod response;
pub mod sessions;
mod store;
mod summary_response;
pub mod web_assets;

use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use tokio::sync::broadcast;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::index::ProjectIndex;
use crate::file_store::watch::{Reloader, WatchMode};
use crate::paths;
pub(crate) use events::WAITING_COMMAND_HEADER;
pub use idle::IdleStop;
pub use launch::{BoardPages, Ended, Ready};
use monitor_connection::lifecycle::{MonitorConnections, MonitorEnv};
pub use monitor_connection::lifecycle::{MonitorOptions, MonitorReady};

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
    /// The shared folder that holds every project's canonical files.
    pub shared: PathBuf,
    /// The index of the shared files, kept current by the watcher.
    pub index: Arc<RwLock<ProjectIndex>>,
    /// Queues a reload after a save made by this server or a notification.
    pub reloader: Reloader,
    /// The numbered change sets the reloader finds; each SSE connection subscribes.
    pub changed: change_feed::ChangeFeed,
    /// The ngrok monitor connection: saved settings, memory-only secrets, supervisor.
    pub monitor: Arc<MonitorConnections>,
    /// The saved language and theme, read and written by `/api/preferences` and the monitor.
    pub preferences: preferences::PreferencesStore,
    /// Sends each saved preference set; the events streams forward it as `preferences`.
    pub preferences_changed: broadcast::Sender<preferences::Preferences>,
    /// The projects whose Docs changed (`None`: any project); the board's stream sends `docs`.
    pub docs_changed: broadcast::Sender<Option<ProjectId>>,
    /// When the server was last used; an automatic server stops after its idle time.
    pub activity: Arc<idle::Activity>,
    /// The agent sessions that wait on the board, counted while their streams are open.
    pub sessions: Arc<sessions::SessionRegistry>,
    /// Starts and stops the headless sessions the board launches.
    pub resident: Arc<resident::Launcher>,
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
    let data_dir = paths::data_dir()?;
    run_until_in(&data_dir, WatchMode::from_env(), config, shutdown, on_ready)
}

/// [`run_until`] with the data area and the watch mode given, not read from the
/// environment. Embedded servers in the tests use it so that they need not set
/// `AGBOARD_HOME` for the whole process.
pub fn run_until_in<F: Future<Output = ()>>(
    data_dir: &Path,
    watch: WatchMode,
    config: ServeConfig,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr),
) -> Result<(), AgboardError> {
    run_until_with_monitor_in(
        data_dir,
        watch,
        config,
        MonitorOptions::without_keychain(MonitorEnv::default(), false),
        shutdown,
        |addr, _| on_ready(addr),
    )
}

/// [`run_until`] plus the ngrok monitor connection. With `--monitor ngrok` the
/// connection is up (or the run has failed) before `on_ready`.
pub fn run_until_with_monitor<F: Future<Output = ()>>(
    config: ServeConfig,
    monitor: MonitorOptions,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr, Option<MonitorReady>),
) -> Result<(), AgboardError> {
    // Resolve the process environment once. Another embedded caller can change
    // AGBOARD_HOME while startup is awaiting file locks or filesystem watches.
    let data_dir = paths::data_dir()?;
    run_until_with_monitor_in(
        &data_dir,
        WatchMode::from_env(),
        config,
        monitor,
        shutdown,
        on_ready,
    )
}

/// [`run_until_with_monitor`] with the data area and the watch mode given.
pub fn run_until_with_monitor_in<F: Future<Output = ()>>(
    data_dir: &Path,
    watch: WatchMode,
    config: ServeConfig,
    monitor: MonitorOptions,
    shutdown: F,
    on_ready: impl FnOnce(SocketAddr, Option<MonitorReady>),
) -> Result<(), AgboardError> {
    let launch = launch::Launch {
        data_dir,
        watch,
        port: config.port,
        auto: None,
    };
    launch::run(launch, monitor, shutdown, |ready| {
        on_ready(ready.addr, ready.monitor)
    })
    .map(|_| ())
}

/// Serve as a server the CLI started by itself: prefer `port` and take a free
/// one when it is taken, and stop after `idle` without use. A signal (SIGUSR1)
/// turns it into a manual server that no longer stops by itself.
pub fn run_auto_until<F: Future<Output = ()>>(
    port: u16,
    idle: IdleStop,
    monitor: MonitorOptions,
    shutdown: F,
    on_ready: impl FnOnce(Ready),
) -> Result<Ended, AgboardError> {
    let data_dir = paths::data_dir()?;
    run_auto_until_in(
        &data_dir,
        WatchMode::from_env(),
        port,
        idle,
        monitor,
        shutdown,
        on_ready,
    )
}

/// [`run_auto_until`] with the data area and the watch mode given.
pub fn run_auto_until_in<F: Future<Output = ()>>(
    data_dir: &Path,
    watch: WatchMode,
    port: u16,
    idle: IdleStop,
    monitor: MonitorOptions,
    shutdown: F,
    on_ready: impl FnOnce(Ready),
) -> Result<Ended, AgboardError> {
    let launch = launch::Launch {
        data_dir,
        watch,
        port,
        auto: Some(idle),
    };
    launch::run(launch, monitor, shutdown, on_ready)
}

/// A temporary file or folder older than this is left over from a crash and is removed at startup.
const STALE_TEMPORARY_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60);
