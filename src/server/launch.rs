//! Starting one server for a data directory, running it, and ending it: on a
//! signal, or, for a server the CLI started by itself, after it went unused.

use std::future::Future;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use tokio::sync::broadcast;

use super::idle::{Activity, IdleStop};
use super::monitor_connection::config::ConfigStore;
use super::monitor_connection::lifecycle::MonitorConnections;
use super::{AppState, MonitorOptions, MonitorReady, api, assets, bind, change_feed, instance};
use super::{STALE_TEMPORARY_AGE, preferences, resident, sessions};
use crate::clock::format_utc;
use crate::docs::DocsLocale;
use crate::error::AgboardError;
use crate::file_store::index::ProjectIndex;
use crate::file_store::watch::{DocsSink, Watch, WatchMode};
use crate::lifecycle::LifecycleGuard;
use crate::paths::{self, ServeInfo, ServeMode};

/// How long an automatic server waits for a stopping server to let go of the
/// data directory.
const AUTO_LIFECYCLE_WAIT: Duration = Duration::from_secs(10);

/// How long a session whose wait ended stays counted: `AGBOARD_SESSION_GRACE_MS` when set to a
/// number of milliseconds (tests shorten it), else [`sessions::GRACE`].
fn session_grace() -> Duration {
    std::env::var("AGBOARD_SESSION_GRACE_MS")
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .map_or(sessions::GRACE, Duration::from_millis)
}

/// What to start.
pub(crate) struct Launch<'a> {
    pub data_dir: &'a Path,
    pub watch: WatchMode,
    /// The port to listen on. An automatic server prefers it and takes a free
    /// port when it is taken; a manual one uses only it.
    pub port: u16,
    /// `Some` for a server the CLI started by itself.
    pub auto: Option<IdleStop>,
}

/// The server is up.
pub struct Ready {
    pub addr: SocketAddr,
    pub monitor: Option<MonitorReady>,
    /// Why an automatic server listens on another port than it preferred.
    pub notice: Option<String>,
    /// Whether a board page has connected since the start.
    pub board: BoardPages,
}

/// Tells whether a board page in a browser has opened an event stream since
/// the server started. A command that waits is not a board page.
#[derive(Clone)]
pub struct BoardPages(Arc<Activity>);

impl BoardPages {
    pub fn connected(&self) -> bool {
        self.0.board_seen()
    }
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// Ctrl+C, SIGTERM, or the caller's shutdown.
    Shutdown,
    /// An automatic server went unused for its idle time.
    Idle,
}

pub(crate) fn run<F: Future<Output = ()>>(
    launch: Launch<'_>,
    monitor: MonitorOptions,
    shutdown: F,
    on_ready: impl FnOnce(Ready),
) -> Result<Ended, AgboardError> {
    let data_dir = launch.data_dir.to_path_buf();
    let serve_path = data_dir.join("serve.json");
    let running = || {
        paths::read_serve_info_in(&data_dir)
            .filter(instance::is_serving)
            .map(|info| AgboardError::AlreadyServing {
                port: info.port,
                auto: info.mode == ServeMode::Auto,
            })
    };
    if let Some(error) = running() {
        return Err(error);
    }
    let lifecycle = match launch.auto {
        None => LifecycleGuard::acquire(&data_dir)?,
        Some(_) => LifecycleGuard::acquire_waiting(&data_dir, AUTO_LIFECYCLE_WAIT, running)?,
    };
    let shared = data_dir.join("shared");
    crate::file_store::io::remove_stale_temporaries(&shared, STALE_TEMPORARY_AGE);
    crate::file_store::FileStore::open(&shared).seed_unseeded_projects(chrono::Utc::now());
    let docs_locale =
        DocsLocale::from_locale(&preferences::PreferencesStore::new(&data_dir).load().locale);
    crate::file_store::FileStore::open(&shared).ensure_docs_dirs(docs_locale);
    let (listener, notice) = match launch.auto {
        None => (bind::bind_exact(launch.port)?, None),
        Some(_) => bind::bind_preferring(launch.port)?,
    };
    let addr = listener
        .local_addr()
        .map_err(|e| bind::bind_error(&e, launch.port))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| internal(format!("Cannot start the server runtime: {e}")))?;
    let ended = runtime.block_on(async move {
        let listener = listener
            .set_nonblocking(true)
            .and_then(|()| tokio::net::TcpListener::from_std(listener))
            .map_err(|e| internal(format!("Cannot listen on {addr}: {e}")))?;

        // The watch exists before the first read, so a change made during the
        // read is queued and read again.
        let index = Arc::new(RwLock::new(ProjectIndex::default()));
        let changed = change_feed::ChangeFeed::new();
        let (preferences_changed, _) = broadcast::channel(16);
        let (docs_changed, _) = broadcast::channel(64);
        let docs_sender = docs_changed.clone();
        let (_watch, reloader) = Watch::start_with_docs(
            &shared,
            launch.watch,
            index.clone(),
            changed.sink(),
            DocsSink::new(move |project| {
                let _ = docs_sender.send(project);
            }),
        )?;
        let activity = Activity::new();
        let sessions = sessions::SessionRegistry::new(session_grace());
        let state = Arc::new(AppState {
            port: addr.port(),
            token: assets::new_token()?,
            shared,
            index,
            reloader,
            changed,
            monitor: MonitorConnections::new(
                ConfigStore::new(&data_dir),
                monitor.connector.clone(),
                monitor.vault.clone(),
                monitor.env.clone(),
            ),
            preferences: preferences::PreferencesStore::new(&data_dir),
            preferences_changed,
            docs_changed,
            activity: activity.clone(),
            sessions: sessions.clone(),
            resident: resident::Launcher::new(
                sessions,
                resident::Executables::from_env(),
                &data_dir,
            ),
        });
        state.monitor.attach(&state);
        let files = state.shared.clone();
        state.resident.start(move |project| {
            resident::resolve_project(&crate::file_store::FileStore::open(&files), project)
        });
        let app = api::router(state.clone());

        // A command-line monitor must be up before the board announces itself;
        // on failure nothing has been written yet, so the run just ends.
        let explicit = monitor.explicit;
        let monitor_ready = match state.monitor.startup(explicit).await {
            Ok(ready) => ready.filter(|_| explicit),
            Err(code) => {
                state.monitor.shutdown();
                return Err(internal(format!(
                    "The ngrok connection could not be started ({}).",
                    code.as_str()
                )));
            }
        };

        let pid = std::process::id();
        let auto = Arc::new(AtomicBool::new(launch.auto.is_some()));
        if launch.auto.is_some() {
            switch_to_manual_on_signal(auto.clone(), serve_path.clone(), pid);
            count_changes_as_use(&state);
        }
        paths::write_serve_info_in(
            &data_dir,
            &ServeInfo {
                pid,
                port: addr.port(),
                started_at: format_utc(chrono::Utc::now()),
                mode: if launch.auto.is_some() {
                    ServeMode::Auto
                } else {
                    ServeMode::Manual
                },
                idle_timeout_seconds: launch.auto.map(|idle| idle.timeout.as_secs()),
            },
        );
        on_ready(Ready {
            addr,
            monitor: monitor_ready,
            notice,
            board: BoardPages(activity.clone()),
        });
        let idle_stop = wait_until_unused(&state, launch.auto, auto, &serve_path, pid);
        let result = tokio::select! {
            served = async { axum::serve(listener, app).await } => {
                served.map(|()| Ended::Shutdown).map_err(|e| internal(format!("The server stopped: {e}")))
            }
            () = shutdown => Ok(Ended::Shutdown),
            () = idle_stop => Ok(Ended::Idle),
        };
        state.monitor.shutdown();
        state.resident.shutdown();
        instance::remove_serve_info_of(&serve_path, pid);
        result
    });
    drop(lifecycle);
    ended
}

/// Complete once an automatic server has gone unused for its idle time, after
/// removing `serve.json`, so that a new command starts a new server. A manual
/// server, or one switched to manual, never completes.
async fn wait_until_unused(
    state: &Arc<AppState>,
    idle: Option<IdleStop>,
    auto: Arc<AtomicBool>,
    serve_path: &Path,
    pid: u32,
) {
    let Some(idle) = idle else {
        return std::future::pending().await;
    };
    let mut ticks = tokio::time::interval(idle.check_every);
    loop {
        ticks.tick().await;
        if !auto.load(Ordering::SeqCst) {
            return std::future::pending().await;
        }
        let busy = state.monitor.is_active();
        if state
            .activity
            .decide_stop(Instant::now(), idle.timeout, busy)
        {
            instance::remove_serve_info_of(serve_path, pid);
            return;
        }
    }
}

/// On SIGUSR1 (`agboard serve -d` while this server runs), stop counting idle
/// time and record the server as manual.
fn switch_to_manual_on_signal(auto: Arc<AtomicBool>, serve_path: std::path::PathBuf, pid: u32) {
    use tokio::signal::unix::{SignalKind, signal};
    let Ok(mut user) = signal(SignalKind::user_defined1()) else {
        return;
    };
    tokio::spawn(async move {
        while user.recv().await.is_some() {
            auto.store(false, Ordering::SeqCst);
            instance::mark_manual(&serve_path, pid);
        }
    });
}

/// A change the watcher saw, in the board or in the Docs, is use: an agent that
/// edits files directly keeps the server running for automatic Done.
fn count_changes_as_use(state: &Arc<AppState>) {
    let mut board = state.changed.subscribe();
    let activity = state.activity.clone();
    tokio::spawn(async move {
        while !matches!(board.recv().await, Err(broadcast::error::RecvError::Closed)) {
            activity.touch();
        }
    });
    let mut docs = state.docs_changed.subscribe();
    let activity = state.activity.clone();
    tokio::spawn(async move {
        while !matches!(docs.recv().await, Err(broadcast::error::RecvError::Closed)) {
            activity.touch();
        }
    });
}

fn internal(reason: String) -> AgboardError {
    AgboardError::DatabaseError { reason }
}
