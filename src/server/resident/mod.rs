//! The headless agent sessions the board starts itself (resident sessions).
//!
//! The launcher runs `claude` or `codex` in the folder of a project unattended, with automatic
//! approval instead of prompts, and keeps its child process. The session then waits on the board like any other and
//! registers with origin `board`. The board keeps at most one such session in total, whichever
//! tool and project. [`cli`] is the only place that knows the CLIs' names and flags.
//!
//! A child lives in its own process group, so stopping it also stops the commands it started (for
//! example its `agboard wait`). A thread reaps each child when it exits, whoever ends it, and
//! takes its entry out of the session registry so that a launch is possible again at once instead
//! of after the registry's grace period.

mod autostart;
pub mod cli;
mod health;
mod process;
mod spawn;
mod supervisor;
mod watch;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::{SessionRegistry, Tool};
pub use autostart::{AutoStart, AutoStartStore};
pub use cli::{Executables, ModelList, ModelOption};
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
    plans: Mutex<HashMap<Tool, Plan>>,
    autostart: AutoStartStore,
    closing: AtomicBool,
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
        Arc::new(Launcher {
            registry,
            executables,
            data_dir: data_dir.to_path_buf(),
            live: Arc::new(Mutex::new(HashMap::new())),
            stop_grace,
            timing,
            plans: Mutex::new(HashMap::new()),
            autostart: AutoStartStore::new(data_dir),
            closing: AtomicBool::new(false),
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<Tool, Live>> {
        self.live.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn plans(&self) -> MutexGuard<'_, HashMap<Tool, Plan>> {
        self.plans.lock().unwrap_or_else(|e| e.into_inner())
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

    /// Take the launch `launch_id` out of the live set and the registry, when it is still there.
    fn forget(&self, tool: Tool, launch_id: &str) {
        let mut live = self.lock();
        if live.get(&tool).is_some_and(|l| l.launch_id == launch_id) {
            live.remove(&tool);
            self.registry.remove_board(tool);
        }
    }

    /// Stop the board-launched session (there is at most one): SIGTERM to its process group,
    /// SIGKILL after the grace time.
    /// Returns whether a session was running. When it returns, a new launch is possible.
    /// A stop clears what the supervisor keeps, so the session is not restarted and
    /// a restart that was waiting or a failure that was shown is cleared too.
    pub fn stop(&self) -> Result<bool, AgboardError> {
        self.plans().clear();
        let targets: Vec<(u32, Arc<Exit>)> = self
            .lock()
            .values()
            .map(|live| (live.pid, live.exit.clone()))
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
            .map(|live| (live.pid, live.exit.clone()));
        if let Some(target) = target {
            terminate(&[target], self.stop_grace);
        }
    }

    /// Stop every launched session (the server is shutting down).
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.plans().clear();
        let targets: Vec<(u32, Arc<Exit>)> = self
            .lock()
            .values()
            .map(|live| (live.pid, live.exit.clone()))
            .collect();
        terminate(&targets, self.stop_grace);
    }
}

#[cfg(all(test, unix))]
mod tests;
