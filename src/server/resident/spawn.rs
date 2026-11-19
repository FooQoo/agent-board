//! Starting one child process of a launched session.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;

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

fn exit_reason(tool: Tool, status: std::io::Result<std::process::ExitStatus>) -> String {
    match status {
        Ok(status) => format!("The {} session exited ({status}).", tool.as_str()),
        Err(e) => format!(
            "The {} session could not be waited for: {e}.",
            tool.as_str()
        ),
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
                &self.data_dir,
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
            started: std::time::Instant::now(),
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
        self.supervise_launch(tool, kind, &launched, project_name, folder);
        live.insert(tool, launched);
        drop(live);

        let launcher = self.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            launcher.forget(tool, &launch_id);
            launcher.on_exit(tool, &launch_id, &exit_reason(tool, status));
            exit.finish();
        });
        Ok(view)
    }
}
