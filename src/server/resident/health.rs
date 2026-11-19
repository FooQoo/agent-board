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

/// The health of the session of one tool, as the sessions response lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub tool: Tool,
    pub state: HealthState,
    pub project_id: Option<ProjectId>,
    pub model: Option<String>,
    /// Why the session is restarting or failed.
    pub reason: Option<String>,
    /// Restarts since the last launch or stop by a person.
    pub restart_count: u32,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub last_exit_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub next_restart_at: Option<DateTime<Utc>>,
    pub auto_start: Option<AutoStart>,
}

const TOOLS: [Tool; 2] = [Tool::ClaudeCode, Tool::Codex];

impl Launcher {
    /// The health of every launchable tool, in the order `claude-code`, `codex`.
    pub fn health(&self) -> Vec<Health> {
        let plans = self.plans();
        TOOLS
            .iter()
            .map(|tool| {
                let auto_start = self.autostart.get(*tool);
                let Some(plan) = plans.get(tool) else {
                    return Health {
                        tool: *tool,
                        state: HealthState::Stopped,
                        project_id: None,
                        model: None,
                        reason: None,
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
                    tool: *tool,
                    state,
                    project_id: Some(plan.project.clone()),
                    model: plan.model.clone(),
                    reason: plan.reason.clone(),
                    restart_count: plan.restarts,
                    last_exit_at: plan.last_exit_at,
                    next_restart_at,
                    auto_start,
                }
            })
            .collect()
    }
}
