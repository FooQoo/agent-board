//! Claude Code over two-way stream-json: `claude -p --input-format stream-json
//! --output-format stream-json`. Instructions go in as `user` lines on standard input, which
//! stays open for the life of the session (closing it ends the session), and everything the CLI
//! does comes out as one JSON object per line.
//!
//! Permissions are as they were with the one-way launch: the CLI runs in its auto mode with its
//! prompts off, so it normally asks nothing. A `can_use_tool` request that does arrive is
//! reported as a [`DriverEvent::PermissionRequest`] and answered through
//! [`AgentDriver::answer_permission`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::json;

use super::claude_parse::{Pending, parse_line, permission_response};
use super::lines::{Line, MAX_LINE, for_each_line};
use super::proc::{Out, Proc, send_line};
use super::{AgentDriver, DriverEvent, PermissionAnswer, StartSpec};
use crate::error::AgboardError;
use crate::server::resident::cli;

pub struct ClaudeDriver {
    program: PathBuf,
    proc: OnceLock<Proc>,
    pending: Arc<Mutex<Pending>>,
    requests: AtomicU64,
}

impl ClaudeDriver {
    pub fn new(program: &Path) -> ClaudeDriver {
        ClaudeDriver {
            program: program.to_path_buf(),
            proc: OnceLock::new(),
            pending: Arc::new(Mutex::new(HashMap::new())),
            requests: AtomicU64::new(0),
        }
    }

    fn proc(&self) -> Result<&Proc, AgboardError> {
        self.proc
            .get()
            .ok_or_else(|| AgboardError::SessionLaunchFailed {
                reason: "The session has not been started.".to_string(),
            })
    }

    fn send(&self, line: &serde_json::Value) -> Result<(), AgboardError> {
        send_line(&self.proc()?.stdin, &line.to_string())
    }
}

fn read(stdout: std::process::ChildStdout, out: Out, pending: Arc<Mutex<Pending>>) {
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
        let parsed = {
            let mut pending = pending.lock().unwrap_or_else(|e| e.into_inner());
            parse_line(text, &mut pending)
        };
        if let Some(reply) = parsed.reply {
            let _ = send_line(&out.stdin, &reply.to_string());
        }
        for event in parsed.events {
            match &event {
                DriverEvent::Started {
                    session_id,
                    tool_version,
                } => {
                    out.busy.store(true, Ordering::SeqCst);
                    if !noted {
                        noted = true;
                        out.log.note(&format!(
                            "claude-code {} session {}",
                            tool_version.as_deref().unwrap_or("(unknown version)"),
                            session_id.as_deref().unwrap_or("(unknown)")
                        ));
                    }
                }
                DriverEvent::TurnEnded(_) => out.busy.store(false, Ordering::SeqCst),
                DriverEvent::Unknown => out.log.note("debug: a message of an unknown kind"),
                _ => {}
            }
            let _ = out.events.send(event);
        }
    });
}

impl AgentDriver for ClaudeDriver {
    fn start(&self, spec: StartSpec) -> Result<(), AgboardError> {
        let pending = self.pending.clone();
        let reader: super::proc::Reader = Box::new(move |stdout, out| read(stdout, out, pending));
        let proc = Proc::spawn(
            &self.program,
            cli::claude_args(spec.model.as_deref()),
            &spec,
            true,
            Some(reader),
        )?;
        if self.proc.set(proc).is_err() {
            return Err(AgboardError::SessionLaunchFailed {
                reason: "The session was already started.".to_string(),
            });
        }
        self.send_user_message(&spec.prompt)
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
        self.proc()?.busy.store(true, Ordering::SeqCst);
        self.send(&json!({"type": "user", "message": {"role": "user", "content": text}}))
    }

    fn answer_permission(&self, id: &str, answer: PermissionAnswer) -> Result<(), AgboardError> {
        let input = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        let Some(input) = input else {
            return Err(AgboardError::SessionLaunchFailed {
                reason: format!("No permission request \"{id}\" is waiting."),
            });
        };
        let behavior = match answer {
            PermissionAnswer::Allow => json!({"behavior": "allow", "updatedInput": input}),
            PermissionAnswer::Deny { reason } => json!({"behavior": "deny", "message": reason}),
        };
        self.send(&permission_response(id, behavior))
    }

    fn interrupt(&self) -> Result<(), AgboardError> {
        let n = self.requests.fetch_add(1, Ordering::SeqCst);
        self.send(&json!({
            "type": "control_request",
            "request_id": format!("agboard-{n}"),
            "request": {"subtype": "interrupt"},
        }))
    }

    fn stop(&self, grace: Duration) {
        if let Some(proc) = self.proc.get() {
            proc.stop(grace);
        }
    }
}
