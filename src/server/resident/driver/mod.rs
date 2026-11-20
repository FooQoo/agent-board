//! How the launcher talks to an agent CLI: the [`AgentDriver`] trait and its events.
//!
//! The supervisor, the health check, and the watcher know nothing about a CLI's wire format.
//! They start a driver, read [`DriverEvent`]s from it, and answer what it asks. Each CLI has one
//! implementation: [`claude`] speaks two-way stream-json, and [`codex`] speaks JSON-RPC with
//! `codex app-server`.
//!
//! Only [`DriverEvent::Exited`] ends a session. A turn that ends is not the end: Claude Code wakes
//! itself when a background command finishes, and a resident agent waits on the board that way.

pub(super) mod claude;
mod claude_parse;
pub(super) mod codex;
mod codex_inbound;
mod codex_parse;
#[cfg(test)]
mod codex_tests;
mod lines;
#[cfg(test)]
pub(super) mod mock;
mod proc;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::AgboardError;
use crate::server::sessions::Tool;

/// Everything a driver needs to start one session.
pub struct StartSpec {
    pub cwd: PathBuf,
    pub model: Option<String>,
    /// The first instruction of the session.
    pub prompt: String,
    /// Folders the session may write besides its working folder.
    pub writable_dirs: Vec<PathBuf>,
    /// Variables to set on the child, after the driver scrubbed the server's own session ones.
    pub env: Vec<(String, String)>,
    /// Where the driver records the raw output of the CLI and its own notes.
    pub log: std::fs::File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionKind {
    Command,
    FileChange,
    Other,
}

/// The answer to a [`DriverEvent::PermissionRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionAnswer {
    Allow,
    /// `reason` reaches the model where the CLI can carry it.
    Deny {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnOutcome {
    Completed,
    Interrupted,
    Failed { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriverEvent {
    /// The CLI reported its session (Claude Code does this at every turn).
    Started {
        session_id: Option<String>,
        tool_version: Option<String>,
    },
    Activity {
        kind: String,
        summary: String,
    },
    /// The CLI waits for [`AgentDriver::answer_permission`] with the same `id`.
    PermissionRequest {
        id: String,
        kind: PermissionKind,
        summary: String,
    },
    /// A turn ended. The session goes on.
    TurnEnded(TurnOutcome),
    /// A message this driver does not know. It has been recorded in the log.
    Unknown,
    /// The process is gone. The last event of a session.
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

/// One agent CLI session. Methods take `&self` so that one thread can read events while another
/// answers or stops.
pub trait AgentDriver: Send + Sync {
    /// Start the CLI and send the first instruction. A write that fails because the CLI already
    /// ended is not an error here; the end shows as [`DriverEvent::Exited`].
    fn start(&self, spec: StartSpec) -> Result<(), AgboardError>;
    /// The process ID, once started.
    fn pid(&self) -> Option<u32>;
    /// Whether the session is between turns. It is busy from the start until a turn ends, and
    /// while a turn runs; an ended session is not idle.
    fn is_idle(&self) -> bool;
    /// What the session waits on besides its own turn: the descriptions of the subagents and
    /// background commands that have started and not ended. Only Claude Code reports them.
    fn background_tasks(&self) -> Vec<String> {
        Vec::new()
    }
    /// Block for the next event. After [`DriverEvent::Exited`] it returns `Exited` again.
    fn next_event(&self) -> DriverEvent;
    /// Hand the session a message at any time. While a turn runs the CLI queues it.
    fn send_user_message(&self, text: &str) -> Result<(), AgboardError>;
    fn answer_permission(&self, id: &str, answer: PermissionAnswer) -> Result<(), AgboardError>;
    /// Ask the CLI to stop the turn in progress.
    fn interrupt(&self) -> Result<(), AgboardError>;
    /// End the session and return when the process is gone: close its input, give it a moment,
    /// then SIGTERM its process group, then SIGKILL after `grace`.
    fn stop(&self, grace: Duration);
}

/// Makes the driver of a tool. The launcher calls it once per child.
pub type DriverFactory = std::sync::Arc<dyn Fn(Tool, &Path) -> Box<dyn AgentDriver> + Send + Sync>;

/// The drivers the board ships: `program` is the executable found for `tool`.
pub fn default_factory() -> DriverFactory {
    std::sync::Arc::new(|tool, program| match tool {
        Tool::Codex => Box::new(codex::CodexDriver::new(program)),
        _ => Box::new(claude::ClaudeDriver::new(program)),
    })
}

/// What a request for permission says, for the policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionRequest {
    pub kind: PermissionKind,
    pub summary: String,
}

/// The one place the server decides a permission request. Today every request is allowed: the
/// CLIs run in their automatic modes and normally ask nothing, so a request means the CLI wants
/// what it already would have done. A later stage can put the decision on the board here.
pub fn decide_permission(_request: &PermissionRequest) -> PermissionAnswer {
    PermissionAnswer::Allow
}
