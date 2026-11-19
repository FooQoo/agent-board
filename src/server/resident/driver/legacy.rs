//! Codex through today's one-way `codex exec --json` launch, behind the same trait. The prompt is
//! an argument, standard input is closed, and nothing can be sent to the session afterwards.
//! This driver stays until a driver for `codex app-server` takes its place.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use super::proc::Proc;
use super::{AgentDriver, DriverEvent, PermissionAnswer, StartSpec, unsupported};
use crate::error::AgboardError;
use crate::server::resident::cli;

pub struct LegacyExecDriver {
    program: PathBuf,
    proc: OnceLock<Proc>,
}

impl LegacyExecDriver {
    pub fn new(program: &Path) -> LegacyExecDriver {
        LegacyExecDriver {
            program: program.to_path_buf(),
            proc: OnceLock::new(),
        }
    }
}

impl AgentDriver for LegacyExecDriver {
    fn start(&self, spec: StartSpec) -> Result<(), AgboardError> {
        let data_dir = spec.writable_dirs.first().cloned().unwrap_or_default();
        let args = cli::codex_args(&spec.cwd, &data_dir, spec.model.as_deref(), &spec.prompt);
        let proc = Proc::spawn(&self.program, args, &spec, false, None)?;
        if self.proc.set(proc).is_err() {
            return Err(AgboardError::SessionLaunchFailed {
                reason: "The session was already started.".to_string(),
            });
        }
        Ok(())
    }

    fn pid(&self) -> Option<u32> {
        self.proc.get().map(|proc| proc.pid)
    }

    /// A one-way run never takes another message, so it is never idle.
    fn is_idle(&self) -> bool {
        false
    }

    fn next_event(&self) -> DriverEvent {
        match self.proc.get() {
            Some(proc) => proc.next_event(),
            None => DriverEvent::Exited {
                code: None,
                signal: None,
            },
        }
    }

    fn send_user_message(&self, _text: &str) -> Result<(), AgboardError> {
        Err(unsupported("take a message while it runs"))
    }

    fn answer_permission(&self, _id: &str, _answer: PermissionAnswer) -> Result<(), AgboardError> {
        Err(unsupported("ask for a permission"))
    }

    fn interrupt(&self) -> Result<(), AgboardError> {
        Err(unsupported("be interrupted"))
    }

    fn stop(&self, grace: Duration) {
        if let Some(proc) = self.proc.get() {
            proc.stop(grace);
        }
    }
}
