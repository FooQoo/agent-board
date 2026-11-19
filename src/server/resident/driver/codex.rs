//! Codex over `codex app-server`: newline-delimited JSON-RPC on standard input and output. The
//! session is one thread; the first instruction is the first `turn/start`, and the agent then
//! works in that one long turn (`agboard wait` runs inside it). The conversation itself is the
//! state machine in [`super::codex_parse`].
//!
//! Permissions are as they were with the one-way `codex exec` launch: the workspace-write sandbox,
//! with the requests it raises reviewed automatically, plus the data area as writable. An
//! approval request that does reach the board is reported as a [`DriverEvent::PermissionRequest`]
//! and answered through [`AgentDriver::answer_permission`]; a denial cannot carry its reason.
//! There is no request to end the server: closing its input does.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use super::codex_parse::{Session, Settings, Step};
use super::lines::{Line, MAX_LINE, for_each_line};
use super::proc::{Out, Proc, send_line};
use super::{AgentDriver, DriverEvent, PermissionAnswer, StartSpec};
use crate::error::AgboardError;
use crate::server::resident::cli;

pub struct CodexDriver {
    program: PathBuf,
    proc: OnceLock<Proc>,
    session: Mutex<Option<Arc<Mutex<Session>>>>,
}

impl CodexDriver {
    pub fn new(program: &Path) -> CodexDriver {
        CodexDriver {
            program: program.to_path_buf(),
            proc: OnceLock::new(),
            session: Mutex::new(None),
        }
    }

    fn session(&self) -> Result<Arc<Mutex<Session>>, AgboardError> {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| AgboardError::SessionLaunchFailed {
                reason: "The session has not been started.".to_string(),
            })
    }

    /// Run `act` on the session and carry out what it asks.
    fn apply(&self, act: impl FnOnce(&mut Session) -> Step) -> Result<(), AgboardError> {
        let session = self.session()?;
        let proc = self
            .proc
            .get()
            .ok_or_else(|| AgboardError::SessionLaunchFailed {
                reason: "The session has not been started.".to_string(),
            })?;
        let mut guard = session.lock().unwrap_or_else(|e| e.into_inner());
        let step = act(&mut guard);
        for line in &step.sends {
            send_line(&proc.stdin, &line.to_string())?;
        }
        if let Some(busy) = step.busy {
            proc.busy.store(busy, Ordering::SeqCst);
        }
        Ok(())
    }
}

fn read(stdout: std::process::ChildStdout, out: Out, session: Arc<Mutex<Session>>) {
    let mut noted = false;
    for_each_line(stdout, MAX_LINE, |line| {
        let text = match line {
            Line::TooLong => {
                out.log
                    .note("a line of the output was too long and was skipped");
                return;
            }
            Line::Text(text) => text,
        };
        out.log.line(text);
        // The lock is held while the lines go out, so that a send from the driver cannot slip
        // between the state change and the line that follows from it.
        let mut session = session.lock().unwrap_or_else(|e| e.into_inner());
        let step = session.on_line(text);
        for note in &step.notes {
            out.log.note(note);
        }
        for line in &step.sends {
            let _ = send_line(&out.stdin, &line.to_string());
        }
        if step.close {
            out.stdin.lock().unwrap_or_else(|e| e.into_inner()).take();
        }
        if let Some(busy) = step.busy {
            out.busy.store(busy, Ordering::SeqCst);
        }
        for event in step.events {
            match &event {
                DriverEvent::Started {
                    session_id,
                    tool_version,
                } if !noted => {
                    noted = true;
                    out.log.note(&format!(
                        "codex {} thread {}",
                        tool_version.as_deref().unwrap_or("(unknown version)"),
                        session_id.as_deref().unwrap_or("(unknown)")
                    ));
                }
                DriverEvent::Unknown => out.log.note("debug: a message of an unknown kind"),
                _ => {}
            }
            let _ = out.events.send(event);
        }
    });
}

impl AgentDriver for CodexDriver {
    fn start(&self, spec: StartSpec) -> Result<(), AgboardError> {
        let settings = Settings {
            cwd: spec.cwd.clone(),
            model: spec.model.clone(),
            writable_dirs: spec.writable_dirs.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let mut session = Session::new(settings, &spec.prompt);
        let hello = session.hello();
        let session = Arc::new(Mutex::new(session));
        *self.session.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.clone());
        let reader: super::proc::Reader = Box::new(move |stdout, out| read(stdout, out, session));
        let proc = Proc::spawn(&self.program, cli::codex_args(), &spec, true, Some(reader))?;
        if self.proc.set(proc).is_err() {
            return Err(AgboardError::SessionLaunchFailed {
                reason: "The session was already started.".to_string(),
            });
        }
        let proc = self
            .proc
            .get()
            .ok_or_else(|| AgboardError::SessionLaunchFailed {
                reason: "The session has not been started.".to_string(),
            })?;
        send_line(&proc.stdin, &hello.to_string())
    }

    fn pid(&self) -> Option<u32> {
        self.proc.get().map(|proc| proc.pid)
    }

    fn is_idle(&self) -> bool {
        self.proc
            .get()
            .is_some_and(|proc| !proc.busy.load(Ordering::SeqCst))
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

    fn send_user_message(&self, text: &str) -> Result<(), AgboardError> {
        self.apply(|session| session.user_message(text))
    }

    fn answer_permission(&self, id: &str, answer: PermissionAnswer) -> Result<(), AgboardError> {
        let session = self.session()?;
        let reply = session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .answer(id, &answer);
        let Some(reply) = reply else {
            return Err(AgboardError::SessionLaunchFailed {
                reason: format!("No permission request \"{id}\" is waiting."),
            });
        };
        let proc = self
            .proc
            .get()
            .ok_or_else(|| AgboardError::SessionLaunchFailed {
                reason: "The session has not been started.".to_string(),
            })?;
        send_line(&proc.stdin, &reply.to_string())
    }

    fn interrupt(&self) -> Result<(), AgboardError> {
        self.apply(Session::interrupt)
    }

    fn stop(&self, grace: Duration) {
        if let Some(proc) = self.proc.get() {
            proc.stop(grace);
        }
    }
}
