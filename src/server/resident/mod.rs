//! The headless agent sessions the board starts itself (resident sessions).
//!
//! The launcher runs `claude` or `codex` in the folder of a project unattended, with automatic
//! approval instead of prompts, and keeps its child process. It talks to the CLI only through an
//! [`driver::AgentDriver`]. The session then waits on the board like any other and
//! registers with origin `board`. The board keeps at most one such session in total, whichever
//! tool and project. [`cli`] is the only place that knows the CLIs' names and flags.
//!
//! A child lives in its own process group, so stopping it also stops the commands it started (for
//! example its `agboard wait`). A thread reaps each child when it exits, whoever ends it, and
//! takes its entry out of the session registry so that a launch is possible again at once instead
//! of after the registry's grace period.

mod autostart;
mod board;
pub mod cli;
pub mod driver;
mod health;
mod process;
mod push;
mod spawn;
mod supervisor;
mod watch;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::{SessionRegistry, Tool};
pub use autostart::{AutoStart, AutoStartStore};
pub use cli::{Executables, ModelList, ModelOption};
use driver::{AgentDriver, DriverFactory};
pub use health::{Health, HealthState};
use process::{Exit, terminate};
use spawn::Spawn;
use supervisor::Plan;
pub use supervisor::Timing;
pub use watch::resolve_project;

/// How long a stopped child has to exit after SIGTERM before it gets SIGKILL.
const STOP_GRACE: Duration = Duration::from_secs(5);
/// The folder of the data area that holds the logs of launched sessions.
const LOG_DIR: &str = "resident";

struct Live {
    launch_id: String,
    pid: u32,
    project: ProjectId,
    model: Option<String>,
    started_at: DateTime<Utc>,
    started: Instant,
    exit: Arc<Exit>,
    driver: Arc<dyn AgentDriver>,
    push: Arc<push::Push>,
}

/// A launched session as the status lists it. The process ID is for the server's own use and is
/// not part of any response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    pub tool: Tool,
    #[serde(skip)]
    pub pid: u32,
    pub project_id: ProjectId,
    pub model: Option<String>,
    #[serde(with = "crate::clock::serde_utc")]
    pub started_at: DateTime<Utc>,
}

/// Starts, tracks and stops the sessions the board launches.
pub struct Launcher {
    registry: Arc<SessionRegistry>,
    executables: Executables,
    data_dir: PathBuf,
    live: Arc<Mutex<HashMap<Tool, Live>>>,
    stop_grace: Duration,
    timing: Timing,
    factory: DriverFactory,
    plans: Mutex<HashMap<Tool, Plan>>,
    /// Serializes the operations that change which child runs: a launch (which runs slow CLI
    /// checks), a stop and a shutdown. The live set is locked only briefly, so reading it (the
    /// status of a session list) never waits for a launch. Taken before `live` and `plans`.
    gate: Mutex<()>,
    /// Counts the changes a person makes to what the board keeps running (a launch, a stop).
    /// A plan carries the value it was made under, and a deferred start or restart is admitted
    /// only while the value is still the one it was prepared under. Changed only with `plans`
    /// held.
    epoch: AtomicU64,
    autostart: AutoStartStore,
    closing: AtomicBool,
    /// The shared data folder of the boards, once the server has told the launcher.
    board: Mutex<Option<PathBuf>>,
}

impl Launcher {
    pub fn new(
        registry: Arc<SessionRegistry>,
        executables: Executables,
        data_dir: &Path,
    ) -> Arc<Launcher> {
        Launcher::with_stop_grace(registry, executables, data_dir, STOP_GRACE)
    }

    pub fn with_stop_grace(
        registry: Arc<SessionRegistry>,
        executables: Executables,
        data_dir: &Path,
        stop_grace: Duration,
    ) -> Arc<Launcher> {
        Launcher::with_timing(
            registry,
            executables,
            data_dir,
            stop_grace,
            Timing::default(),
        )
    }

    pub fn with_timing(
        registry: Arc<SessionRegistry>,
        executables: Executables,
        data_dir: &Path,
        stop_grace: Duration,
        timing: Timing,
    ) -> Arc<Launcher> {
        Launcher::with_factory(
            registry,
            executables,
            data_dir,
            stop_grace,
            timing,
            driver::default_factory(),
        )
    }

    /// A launcher whose children are driven by `factory` instead of the shipped drivers.
    pub fn with_factory(
        registry: Arc<SessionRegistry>,
        executables: Executables,
        data_dir: &Path,
        stop_grace: Duration,
        timing: Timing,
        factory: DriverFactory,
    ) -> Arc<Launcher> {
        Arc::new(Launcher {
            registry,
            executables,
            data_dir: data_dir.to_path_buf(),
            live: Arc::new(Mutex::new(HashMap::new())),
            stop_grace,
            timing,
            factory,
            plans: Mutex::new(HashMap::new()),
            gate: Mutex::new(()),
            epoch: AtomicU64::new(0),
            autostart: AutoStartStore::new(data_dir),
            closing: AtomicBool::new(false),
            board: Mutex::new(None),
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<Tool, Live>> {
        self.live.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn plans(&self) -> MutexGuard<'_, HashMap<Tool, Plan>> {
        self.plans.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn gate(&self) -> MutexGuard<'_, ()> {
        self.gate.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The current epoch; see the field.
    fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    /// Forget every plan and end the epoch, so nothing prepared under it is admitted any more.
    fn reset_plans(&self) {
        let mut plans = self.plans();
        plans.clear();
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst)
    }

    /// The saved auto-start choices.
    pub fn autostart(&self) -> &AutoStartStore {
        &self.autostart
    }

    /// The log of the session of `tool`, replaced at every launch.
    pub fn log_path(&self, tool: Tool) -> PathBuf {
        self.data_dir
            .join(LOG_DIR)
            .join(format!("{}.log", tool.as_str()))
    }

    /// The models to offer for `tool`; see [`Executables::models`].
    pub fn models(&self, tool: Tool) -> Result<ModelList, AgboardError> {
        self.executables.models(tool)
    }

    /// The sessions with a live child, ordered by tool name.
    pub fn status(&self) -> Vec<Launched> {
        let mut found: Vec<Launched> = self
            .lock()
            .iter()
            .map(|(tool, live)| Launched {
                tool: *tool,
                pid: live.pid,
                project_id: live.project.clone(),
                model: live.model.clone(),
                started_at: live.started_at,
            })
            .collect();
        found.sort_by_key(|launched| launched.tool.as_str());
        found
    }

    /// Start a session of `tool` in `folder` for the project named `project_name`. `model` of
    /// `None` uses the tool's own default. Refused while this launcher has a live child of the
    /// tool (which closes the gap before its wait registers) or the registry counts a
    /// board-launched session of it. A launch by a person starts supervision: see [`supervisor`].
    pub fn launch(
        self: &Arc<Self>,
        project: &ProjectId,
        project_name: &str,
        folder: &Path,
        tool: Tool,
        model: Option<&str>,
    ) -> Result<Launched, AgboardError> {
        self.spawn_child(project, project_name, folder, tool, model, Spawn::User)
    }

    /// The start of the saved auto-start: a launch that is admitted only while `epoch` (read with
    /// [`Launcher::epoch`] before the project was resolved) is still current, so a stop or another
    /// launch in the meantime cancels it.
    pub(super) fn launch_auto(
        self: &Arc<Self>,
        epoch: u64,
        project: &ProjectId,
        project_name: &str,
        folder: &Path,
        tool: Tool,
        model: Option<&str>,
    ) -> Result<Launched, AgboardError> {
        self.spawn_child(
            project,
            project_name,
            folder,
            tool,
            model,
            Spawn::Auto(epoch),
        )
    }

    /// Take the launch `launch_id` out of the live set and the registry, when it is still there.
    fn forget(&self, tool: Tool, launch_id: &str) {
        let mut live = self.lock();
        if live.get(&tool).is_some_and(|l| l.launch_id == launch_id) {
            live.remove(&tool);
            self.registry.remove_board(tool);
        }
    }

    /// Stop the board-launched session (there is at most one): the driver closes its input, then
    /// SIGTERM to its process group, SIGKILL after the grace time.
    /// Returns whether a session was running. When it returns, a new launch is possible.
    /// A stop clears what the supervisor keeps, so the session is not restarted and
    /// a restart that was waiting or a failure that was shown is cleared too.
    pub fn stop(&self) -> Result<bool, AgboardError> {
        // The gate keeps a launch that is already running from adding its plan after the clear.
        let _gate = self.gate();
        self.reset_plans();
        let targets: Vec<(Arc<dyn AgentDriver>, Arc<Exit>)> = self
            .lock()
            .values()
            .map(|live| (live.driver.clone(), live.exit.clone()))
            .collect();
        if targets.is_empty() {
            return Ok(false);
        }
        terminate(&targets, self.stop_grace);
        Ok(true)
    }

    /// End the child of `tool` without clearing its plan (the supervisor ends an unhealthy one).
    fn kill(&self, tool: Tool) {
        let target = self
            .lock()
            .get(&tool)
            .map(|live| (live.driver.clone(), live.exit.clone()));
        if let Some(target) = target {
            terminate(&[target], self.stop_grace);
        }
    }

    /// Stop every launched session (the server is shutting down).
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        let _gate = self.gate();
        self.reset_plans();
        let targets: Vec<(Arc<dyn AgentDriver>, Arc<Exit>)> = self
            .lock()
            .values()
            .map(|live| (live.driver.clone(), live.exit.clone()))
            .collect();
        terminate(&targets, self.stop_grace);
    }
}

#[cfg(all(test, unix))]
mod tests;
