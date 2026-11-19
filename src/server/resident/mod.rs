//! The headless agent sessions the board starts itself (resident sessions).
//!
//! The launcher runs `claude` or `codex` in the folder of a project with every permission and no
//! prompts, and keeps its child process. The session then waits on the board like any other and
//! registers with origin `board`. At most one session per tool is launched by the board, over all
//! projects. [`cli`] is the only place that knows the CLIs' names and flags.
//!
//! A child lives in its own process group, so stopping it also stops the commands it started (for
//! example its `agboard wait`). A thread reaps each child when it exits, whoever ends it, and
//! takes its entry out of the session registry so that a launch is possible again at once instead
//! of after the registry's grace period.

pub mod cli;

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::{SessionRegistry, Tool};
pub use cli::{Executables, ModelList, ModelOption};

/// How long a stopped child has to exit after SIGTERM before it gets SIGKILL.
const STOP_GRACE: Duration = Duration::from_secs(5);
/// The folder of the data area that holds the logs of launched sessions.
const LOG_DIR: &str = "resident";

/// Marks a finished child; set by the reaper after it has cleaned up.
struct Exit {
    done: Mutex<bool>,
    changed: Condvar,
}

impl Exit {
    fn new() -> Arc<Exit> {
        Arc::new(Exit {
            done: Mutex::new(false),
            changed: Condvar::new(),
        })
    }

    fn finish(&self) {
        *self.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }

    fn wait(&self, limit: Duration) -> bool {
        let guard = self.done.lock().unwrap_or_else(|e| e.into_inner());
        let (guard, _) = self
            .changed
            .wait_timeout_while(guard, limit, |done| !*done)
            .unwrap_or_else(|e| e.into_inner());
        *guard
    }
}

struct Live {
    launch_id: String,
    pid: u32,
    project: ProjectId,
    model: Option<String>,
    started_at: DateTime<Utc>,
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
        Arc::new(Launcher {
            registry,
            executables,
            data_dir: data_dir.to_path_buf(),
            live: Arc::new(Mutex::new(HashMap::new())),
            stop_grace,
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<Tool, Live>> {
        self.live.lock().unwrap_or_else(|e| e.into_inner())
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
    /// board-launched session of it.
    pub fn launch(
        self: &Arc<Self>,
        project: &ProjectId,
        project_name: &str,
        folder: &Path,
        tool: Tool,
        model: Option<&str>,
    ) -> Result<Launched, AgboardError> {
        let tool = cli::launchable(tool)?;
        if let Some(model) = model.filter(|model| !cli::valid_model(model)) {
            return Err(AgboardError::InvalidValue {
                field: "model".to_string(),
                reason: format!("\"{model}\" is not a model name."),
            });
        }
        let mut live = self.lock();
        let refused = |reason: String| AgboardError::SessionLaunchRefused { reason };
        if live.contains_key(&tool) {
            return Err(refused(format!(
                "A {} session launched by the board is already running. Stop it first.",
                tool.as_str()
            )));
        }
        if self.registry.check_board_launch(tool).is_err() {
            return Err(refused(format!(
                "A {} session launched by the board is already attached. Stop it first, or wait for it to leave.",
                tool.as_str()
            )));
        }
        let program = self.executables.check(tool)?;
        if let Some(model) = model {
            let offered = self.executables.models(tool)?;
            if !offered.models.is_empty() && !offered.models.iter().any(|m| m.id == model) {
                return Err(AgboardError::InvalidValue {
                    field: "model".to_string(),
                    reason: format!("\"{model}\" is not one of the models of {}.", tool.as_str()),
                });
            }
        }
        let failed = |reason: String| AgboardError::SessionLaunchFailed { reason };
        let log_path = self.log_path(tool);
        let log = open_log(&log_path)
            .map_err(|e| failed(format!("Cannot write {}: {e}.", log_path.display())))?;
        let log_err = log
            .try_clone()
            .map_err(|e| failed(format!("Cannot write {}: {e}.", log_path.display())))?;
        let launch_id = new_launch_id()?;
        let mut command = Command::new(&program);
        command
            .args(cli::launch_args(
                tool,
                folder,
                model,
                &cli::prompt(project_name),
            ))
            .current_dir(folder)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err));
        for (name, _) in std::env::vars_os() {
            if name.to_str().is_some_and(cli::scrubbed) {
                command.env_remove(&name);
            }
        }
        command
            .env("AGBOARD_RESIDENT_ID", &launch_id)
            .env("AGBOARD_SESSION_TOOL", tool.as_str())
            .env("AGBOARD_SESSION_ORIGIN", "board");
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut command, 0);
        let mut child = command.spawn().map_err(|e| {
            failed(format!(
                "{} could not be started: {e}.",
                program
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ))
        })?;
        let launched = Live {
            launch_id: launch_id.clone(),
            pid: child.id(),
            project: project.clone(),
            model: model.map(str::to_string),
            started_at: SystemClock.now(),
            exit: Exit::new(),
        };
        let view = Launched {
            tool,
            pid: launched.pid,
            project_id: launched.project.clone(),
            model: launched.model.clone(),
            started_at: launched.started_at,
        };
        let exit = launched.exit.clone();
        live.insert(tool, launched);
        drop(live);

        let launcher = self.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            launcher.forget(tool, &launch_id);
            exit.finish();
        });
        Ok(view)
    }

    /// Take the launch `launch_id` out of the live set and the registry, when it is still there.
    fn forget(&self, tool: Tool, launch_id: &str) {
        let mut live = self.lock();
        if live.get(&tool).is_some_and(|l| l.launch_id == launch_id) {
            live.remove(&tool);
            self.registry.remove_board(tool);
        }
    }

    /// Stop the session of `tool`: SIGTERM to its process group, SIGKILL after the grace time.
    /// Returns whether a session was running. When it returns, a new launch is possible.
    pub fn stop(&self, tool: Tool) -> Result<bool, AgboardError> {
        let target = self
            .lock()
            .get(&tool)
            .map(|live| (live.pid, live.exit.clone()));
        let Some((pid, exit)) = target else {
            return Ok(false);
        };
        terminate(&[(pid, exit)], self.stop_grace);
        Ok(true)
    }

    /// Stop every launched session (the server is shutting down).
    pub fn shutdown(&self) {
        let targets: Vec<(u32, Arc<Exit>)> = self
            .lock()
            .values()
            .map(|live| (live.pid, live.exit.clone()))
            .collect();
        terminate(&targets, self.stop_grace);
    }
}

/// SIGTERM every group, wait for each to be reaped, SIGKILL what is left.
fn terminate(targets: &[(u32, Arc<Exit>)], grace: Duration) {
    for (pid, _) in targets {
        signal_group(*pid, false);
    }
    let deadline = Instant::now() + grace;
    for (pid, exit) in targets {
        let left = deadline.saturating_duration_since(Instant::now());
        if !exit.wait(left) {
            signal_group(*pid, true);
            exit.wait(Duration::from_secs(2));
        }
    }
}

#[cfg(unix)]
fn signal_group(pid: u32, kill: bool) {
    let signal = if kill { libc::SIGKILL } else { libc::SIGTERM };
    // SAFETY: plain syscalls; the child was started as the leader of its own process group, so
    // `-pid` names only that child and the commands it started.
    unsafe {
        libc::kill(-(pid as i32), signal);
        libc::kill(pid as i32, signal);
    }
}

#[cfg(not(unix))]
fn signal_group(_pid: u32, _kill: bool) {}

fn open_log(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// A random launch ID: `resident-` and 16 hex digits.
fn new_launch_id() -> Result<String, AgboardError> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| AgboardError::SessionLaunchFailed {
        reason: format!("Cannot create a launch ID: {e}."),
    })?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("resident-{hex}"))
}

#[cfg(all(test, unix))]
mod tests;
