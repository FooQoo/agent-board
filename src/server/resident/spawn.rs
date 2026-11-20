//! Starting one child process of a launched session.

use std::path::Path;
use std::sync::Arc;

use super::driver::{
    AgentDriver, DriverEvent, PermissionRequest, StartSpec, TurnOutcome, decide_permission,
};
use super::process::{Exit, new_launch_id, open_log};
use super::push::{self, Push};
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
    /// The saved auto-start, prepared under this epoch.
    Auto(u64),
    /// A restart of the plan that was made under this epoch.
    Relaunch(u64),
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
        // Held to the end: a launch, a stop and a restart never interleave. The live set is locked
        // only to look at it and to add the child, not during the slow checks below.
        let _gate = self.gate();
        if self.is_closing() {
            return Err(refused_stopped());
        }
        match kind {
            Spawn::Relaunch(generation) if !self.restart_pending(tool, generation) => {
                return Err(refused_stopped());
            }
            Spawn::Auto(epoch) if epoch != self.epoch() => {
                return Err(AgboardError::SessionLaunchRefused {
                    reason: "The saved auto-start was cancelled by a stop or another launch."
                        .to_string(),
                });
            }
            _ => {}
        }
        let refused = |reason: String| AgboardError::SessionLaunchRefused { reason };
        // One board-launched session in total: any live child, or a restart that is waiting,
        // holds the slot (a restart of the same tool is the supervisor itself).
        let running = self.lock().keys().next().copied();
        if let Some(running) = running {
            return Err(refused(format!(
                "A {} session launched by the board is already running. Stop it first.",
                running.as_str()
            )));
        }
        if !matches!(kind, Spawn::Relaunch(_))
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
            push: Arc::new(push::Push::new()),
        };
        let view = Launched {
            tool,
            pid: launched.pid,
            project_id: launched.project.clone(),
            model: launched.model.clone(),
            started_at: launched.started_at,
        };
        let exit = launched.exit.clone();
        let push = launched.push.clone();
        {
            let mut live = self.lock();
            self.supervise_launch(tool, kind, &launched, project_name, folder);
            live.insert(tool, launched);
        }

        // The pusher gives the idle session what the board has for it.
        let pusher = self.clone();
        let (pusher_driver, pusher_push) = (driver.clone(), push.clone());
        let (pusher_project, pusher_name, pusher_id) =
            (project.clone(), project_name.to_string(), launch_id.clone());
        std::thread::spawn(move || {
            pusher.run_pusher(
                &pusher_project,
                &pusher_name,
                &pusher_id,
                pusher_driver.as_ref(),
                &pusher_push,
            );
        });

        let launcher = self.clone();
        let project = project.clone();
        std::thread::spawn(move || {
            let reason = launcher.pump(tool, &launch_id, &project, driver.as_ref(), &push);
            // A session that dies in the middle of a turn leaves its task running too.
            if launcher.is_current_plan(tool, &launch_id) {
                launcher.hand_over(&project, &push.take_handed(), &reason);
            }
            push.close();
            launcher.forget(tool, &launch_id);
            launcher.on_exit(tool, &launch_id, &reason);
            exit.finish();
        });
        Ok(view)
    }
}

impl Launcher {
    /// Read the events of a session until it exits, and answer what it asks. This is the one
    /// channel through which a driver reaches the launcher. The first event shows the child is
    /// attached, and the end of a turn wakes the pusher. Returns why the session ended.
    fn pump(
        &self,
        tool: Tool,
        launch_id: &str,
        project: &ProjectId,
        driver: &dyn AgentDriver,
        push: &Push,
    ) -> String {
        loop {
            match driver.next_event() {
                DriverEvent::Exited { code, signal } => return exit_reason(tool, code, signal),
                DriverEvent::PermissionRequest { id, kind, summary } => {
                    let answer = decide_permission(&PermissionRequest { kind, summary });
                    // A request that cannot be answered ends with the session; nothing to do here.
                    let _ = driver.answer_permission(&id, answer);
                }
                DriverEvent::Started { .. } => {
                    push.attach(SystemClock.now());
                    self.on_attached(tool, launch_id);
                }
                DriverEvent::TurnEnded(outcome) => {
                    push.attach(SystemClock.now());
                    self.on_attached(tool, launch_id);
                    let handed = push.take_handed();
                    // A turn that a person's stop cut short is not an error to hand over.
                    if let TurnOutcome::Failed { message } = &outcome
                        && self.is_current_plan(tool, launch_id)
                    {
                        self.hand_over(project, &handed, message);
                    }
                    push.turn_ended(&outcome);
                }
                DriverEvent::Activity { .. } | DriverEvent::Unknown => {}
            }
        }
    }

    /// Push work to the session while it lives: look at the board when woken (the board changed,
    /// or a turn ended) and at least every `push_poll`.
    fn run_pusher(
        &self,
        project: &ProjectId,
        project_name: &str,
        launch_id: &str,
        driver: &dyn AgentDriver,
        push: &Push,
    ) {
        let policy = push::Policy::of(&self.timing);
        while !push.is_closed() && !self.is_closing() {
            push.sleep(self.timing.push_poll);
            if push.is_closed() || self.is_closing() {
                break;
            }
            let Some(shared) = self.board_dir() else {
                continue;
            };
            if !self.is_current(launch_id) {
                break;
            }
            push::push_once(&shared, project, project_name, driver, push, &policy);
        }
    }

    /// Whether `launch_id` is the child the launcher keeps.
    fn is_current(&self, launch_id: &str) -> bool {
        self.lock().values().any(|live| live.launch_id == launch_id)
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
