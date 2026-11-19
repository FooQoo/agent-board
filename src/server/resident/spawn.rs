//! Starting one child process of a launched session.

use std::path::Path;
use std::sync::Arc;

use super::driver::{AgentDriver, DriverEvent, PermissionRequest, StartSpec, decide_permission};
use super::process::{Exit, new_launch_id, open_log};
use super::{Launched, Launcher, Live, cli};
use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::Tool;

/// Who starts the child: a person (a launch request, or the start of the server), or the
/// supervisor, which brings back a session that died.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Spawn {
    User,
    Relaunch,
}

fn refused_stopped() -> AgboardError {
    AgboardError::SessionLaunchRefused {
        reason: "The session was stopped before it could be restarted.".to_string(),
    }
}

impl Launcher {
    pub(super) fn spawn_child(
        self: &Arc<Self>,
        project: &ProjectId,
        project_name: &str,
        folder: &Path,
        tool: Tool,
        model: Option<&str>,
        kind: Spawn,
    ) -> Result<Launched, AgboardError> {
        let tool = cli::launchable(tool)?;
        if let Some(model) = model.filter(|model| !cli::valid_model(model)) {
            return Err(AgboardError::InvalidValue {
                field: "model".to_string(),
                reason: format!("\"{model}\" is not a model name."),
            });
        }
        let mut live = self.lock();
        if kind == Spawn::Relaunch && !self.restart_pending(tool) {
            return Err(refused_stopped());
        }
        let refused = |reason: String| AgboardError::SessionLaunchRefused { reason };
        // One board-launched session in total: any live child, or a restart that is waiting,
        // holds the slot (a restart of the same tool is the supervisor itself).
        if let Some(running) = live.keys().next() {
            return Err(refused(format!(
                "A {} session launched by the board is already running. Stop it first.",
                running.as_str()
            )));
        }
        if kind == Spawn::User
            && let Some(waiting) = self.restarting_tool()
        {
            return Err(refused(format!(
                "A {} session launched by the board is restarting. Stop it first.",
                waiting.as_str()
            )));
        }
        if let Err(held) = self.registry.check_board_launch() {
            return Err(refused(format!(
                "A {} session launched by the board is already attached. Stop it first, or wait for it to leave.",
                held.tool.as_str()
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
        let launch_id = new_launch_id()?;
        let driver: Arc<dyn AgentDriver> = Arc::from((self.factory)(tool, &program));
        driver.start(StartSpec {
            cwd: folder.to_path_buf(),
            model: model.map(str::to_string),
            prompt: cli::prompt(project_name),
            writable_dirs: vec![self.data_dir.clone()],
            env: vec![
                ("AGBOARD_RESIDENT_ID".to_string(), launch_id.clone()),
                (
                    "AGBOARD_SESSION_TOOL".to_string(),
                    tool.as_str().to_string(),
                ),
                ("AGBOARD_SESSION_ORIGIN".to_string(), "board".to_string()),
            ],
            log,
        })?;
        let launched = Live {
            launch_id: launch_id.clone(),
            pid: driver.pid().unwrap_or(0),
            project: project.clone(),
            model: model.map(str::to_string),
            started_at: SystemClock.now(),
            started: std::time::Instant::now(),
            exit: Exit::new(),
            driver: driver.clone(),
        };
        let view = Launched {
            tool,
            pid: launched.pid,
            project_id: launched.project.clone(),
            model: launched.model.clone(),
            started_at: launched.started_at,
        };
        let exit = launched.exit.clone();
        self.supervise_launch(tool, kind, &launched, project_name, folder);
        live.insert(tool, launched);
        drop(live);

        let launcher = self.clone();
        std::thread::spawn(move || {
            let reason = pump(tool, driver.as_ref());
            launcher.forget(tool, &launch_id);
            launcher.on_exit(tool, &launch_id, &reason);
            exit.finish();
        });
        Ok(view)
    }
}

/// Read the events of a session until it exits, and answer what it asks. This is the one channel
/// through which a driver reaches the launcher. Returns why the session ended.
fn pump(tool: Tool, driver: &dyn AgentDriver) -> String {
    loop {
        match driver.next_event() {
            DriverEvent::Exited { code, signal } => return exit_reason(tool, code, signal),
            DriverEvent::PermissionRequest { id, kind, summary } => {
                let answer = decide_permission(&PermissionRequest { kind, summary });
                // A request that cannot be answered ends with the session; nothing to do here.
                let _ = driver.answer_permission(&id, answer);
            }
            DriverEvent::Started { .. }
            | DriverEvent::Activity { .. }
            | DriverEvent::TurnEnded(_)
            | DriverEvent::Unknown => {}
        }
    }
}

fn exit_reason(tool: Tool, code: Option<i32>, signal: Option<i32>) -> String {
    let how = match (code, signal) {
        (Some(code), _) => format!("exit status: {code}"),
        (None, Some(9)) => "signal: 9 (SIGKILL)".to_string(),
        (None, Some(15)) => "signal: 15 (SIGTERM)".to_string(),
        (None, Some(signal)) => format!("signal: {signal}"),
        (None, None) => "unknown status".to_string(),
    };
    format!("The {} session exited ({how}).", tool.as_str())
}
