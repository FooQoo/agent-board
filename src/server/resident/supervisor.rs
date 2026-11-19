//! Keeping launched sessions alive: relaunch after a crash with a backoff, give up after a crash
//! loop, replace a child that stays up without ever waiting on the board, and report the health
//! of each tool.
//!
//! A [`Plan`] is what the board means to keep running for a tool. A person's launch creates it
//! and a stop removes it, so a stop never leads to a restart. The reaper thread of a child reports
//! its exit through `on_exit`, and the supervisor thread ticks to start due restarts and to check
//! that a running child has attached.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

use super::Launcher;
use super::autostart::AutoStart;
use super::spawn::Spawn;
use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::Tool;

/// The times the supervisor works with. Tests shorten them.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// How often the supervisor looks at the sessions.
    pub tick: Duration,
    /// The wait before the first restart; each further failure doubles it.
    pub backoff_base: Duration,
    pub backoff_max: Duration,
    /// This many failures within `window` stop the restarts.
    pub max_failures: usize,
    /// A session that stayed up this long starts counting again from zero.
    pub window: Duration,
    /// How long a new child has to attach (register a wait on the board) before it is unhealthy.
    pub startup_allowance: Duration,
    /// How long an attached child may go without a registered wait before it is unhealthy.
    pub detached_after: Duration,
}

impl Default for Timing {
    fn default() -> Timing {
        Timing {
            tick: Duration::from_secs(1),
            backoff_base: Duration::from_secs(2),
            backoff_max: Duration::from_secs(60),
            max_failures: 5,
            window: Duration::from_secs(10 * 60),
            startup_allowance: Duration::from_secs(3 * 60),
            detached_after: Duration::from_secs(3 * 60),
        }
    }
}

pub(super) enum PlanState {
    Running,
    Restarting { due: Instant, due_at: DateTime<Utc> },
    Failed,
}

/// What the board keeps running for one tool.
pub(super) struct Plan {
    pub project: ProjectId,
    pub project_name: String,
    pub folder: PathBuf,
    pub model: Option<String>,
    pub state: PlanState,
    pub launch_id: String,
    pub started: Instant,
    /// The last time the registry counted a board session of the tool, once there was one.
    pub attached: Option<Instant>,
    pub failures: Vec<Instant>,
    pub restarts: u32,
    pub last_exit_at: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    /// Why the supervisor itself ended the child, told to the reaper.
    pub kill_reason: Option<String>,
}

impl Plan {
    pub(super) fn new(
        project: &ProjectId,
        project_name: &str,
        folder: &std::path::Path,
        model: Option<&str>,
        launch_id: &str,
    ) -> Plan {
        Plan {
            project: project.clone(),
            project_name: project_name.to_string(),
            folder: folder.to_path_buf(),
            model: model.map(str::to_string),
            state: PlanState::Running,
            launch_id: launch_id.to_string(),
            started: Instant::now(),
            attached: None,
            failures: Vec::new(),
            restarts: 0,
            last_exit_at: None,
            reason: None,
            kill_reason: None,
        }
    }

    /// Record a failure and decide: restart after a backoff, or give up.
    pub(super) fn fail(&mut self, timing: &Timing, reason: String, retryable: bool) {
        let now = Instant::now();
        self.failures
            .retain(|at| now.saturating_duration_since(*at) < timing.window);
        self.failures.push(now);
        let count = self.failures.len();
        if !retryable || count >= timing.max_failures {
            self.reason = Some(if retryable {
                format!(
                    "{reason} It failed {count} times within {}, so the board stopped restarting it.",
                    span(timing.window)
                )
            } else {
                reason
            });
            self.state = PlanState::Failed;
            return;
        }
        let factor = 1u32 << (count - 1).min(16);
        let delay = (timing.backoff_base * factor).min(timing.backoff_max);
        self.reason = Some(reason);
        self.state = PlanState::Restarting {
            due: now + delay,
            due_at: SystemClock.now() + chrono::Duration::from_std(delay).unwrap_or_default(),
        };
    }
}

pub(super) fn span(duration: Duration) -> String {
    let secs = duration.as_secs();
    if secs >= 60 && secs.is_multiple_of(60) {
        format!("{} minutes", secs / 60)
    } else {
        format!("{secs} seconds")
    }
}

/// Only a failed start of the process can pass by itself; a missing command, a logged-out
/// tool, or a bad value stays wrong until a person fixes it.
pub(super) fn retryable(error: &AgboardError) -> bool {
    matches!(error, AgboardError::SessionLaunchFailed { .. })
}

impl Launcher {
    pub(super) fn restart_pending(&self, tool: Tool) -> bool {
        matches!(
            self.plans().get(&tool).map(|plan| &plan.state),
            Some(PlanState::Restarting { .. })
        )
    }

    /// Called under the live lock when a child has been started.
    pub(super) fn supervise_launch(
        &self,
        tool: Tool,
        kind: Spawn,
        launched: &super::Live,
        project_name: &str,
        folder: &std::path::Path,
    ) {
        let mut plans = self.plans();
        match (kind, plans.get_mut(&tool)) {
            (Spawn::Relaunch, Some(plan)) => {
                plan.state = PlanState::Running;
                plan.launch_id = launched.launch_id.clone();
                plan.started = launched.started;
                plan.attached = None;
                plan.reason = None;
                plan.restarts += 1;
            }
            _ => {
                plans.insert(
                    tool,
                    Plan::new(
                        &launched.project,
                        project_name,
                        folder,
                        launched.model.as_deref(),
                        &launched.launch_id,
                    ),
                );
            }
        }
    }

    /// The reaper reports that the child `launch_id` exited. Nothing happens when a person
    /// stopped it (the plan is gone) or the server is shutting down.
    pub(super) fn on_exit(&self, tool: Tool, launch_id: &str, reason: &str) {
        let mut plans = self.plans();
        let Some(plan) = plans.get_mut(&tool) else {
            return;
        };
        if plan.launch_id != launch_id || !matches!(plan.state, PlanState::Running) {
            return;
        }
        if plan.started.elapsed() >= self.timing.window {
            plan.failures.clear();
        }
        plan.last_exit_at = Some(SystemClock.now());
        let reason = plan
            .kill_reason
            .take()
            .unwrap_or_else(|| reason.to_string());
        plan.fail(&self.timing, reason, true);
    }

    /// A start that did not even produce a child (auto-start at server start).
    pub(super) fn start_failed(
        &self,
        tool: Tool,
        project: &ProjectId,
        choice: &AutoStart,
        name: &str,
        folder: &std::path::Path,
        error: &AgboardError,
    ) {
        let mut plan = Plan::new(project, name, folder, choice.model.as_deref(), "");
        plan.fail(&self.timing, error.reason(), retryable(error));
        self.plans().insert(tool, plan);
    }
}
