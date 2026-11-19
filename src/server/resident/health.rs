//! The health of each tool's session, as the API reports it.

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::Launcher;
use super::autostart::AutoStart;
use super::supervisor::PlanState;
use crate::domain::ProjectId;
use crate::server::sessions::Tool;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HealthState {
    Running,
    Restarting,
    Stopped,
    Failed,
}

/// The health of the board-launched session (there is at most one), as the sessions response
/// carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// The tool of the session the board keeps, `None` when there is none.
    pub tool: Option<Tool>,
    pub state: HealthState,
    pub project_id: Option<ProjectId>,
    pub model: Option<String>,
    /// Why the session is restarting or failed.
    pub reason: Option<String>,
    /// Whether the session's wait is registered now. A running session that does not wait is
    /// working on a task.
    pub waiting: bool,
    /// Restarts since the last launch or stop by a person.
    pub restart_count: u32,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub last_exit_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub next_restart_at: Option<DateTime<Utc>>,
    pub auto_start: Option<AutoStart>,
}

impl Launcher {
    /// The health of the one session slot. `tool` is `None` while nothing is launched.
    pub fn health(&self) -> Health {
        let auto_start = self.autostart.get();
        let plans = self.plans();
        let Some((tool, plan)) = plans.iter().next() else {
            return Health {
                tool: None,
                state: HealthState::Stopped,
                project_id: None,
                model: None,
                reason: None,
                waiting: false,
                restart_count: 0,
                last_exit_at: None,
                next_restart_at: None,
                auto_start,
            };
        };
        let (state, next_restart_at) = match plan.state {
            PlanState::Running => (HealthState::Running, None),
            PlanState::Restarting { due_at, .. } => (HealthState::Restarting, Some(due_at)),
            PlanState::Failed => (HealthState::Failed, None),
        };
        Health {
            tool: Some(*tool),
            state,
            project_id: Some(plan.project.clone()),
            model: plan.model.clone(),
            reason: plan.reason.clone(),
            waiting: matches!(plan.state, PlanState::Running) && self.registry.has_board(*tool),
            restart_count: plan.restarts,
            last_exit_at: plan.last_exit_at,
            next_restart_at,
            auto_start,
        }
    }
}
