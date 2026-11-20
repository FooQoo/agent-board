//! The health of each tool's session, as the API reports it.

use chrono::{DateTime, Utc};
use serde::Serialize;

use std::sync::Arc;

use super::Launcher;
use super::autostart::AutoStart;
use super::driver::AgentDriver;
use super::push::{self, Stalled};
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
    /// Whether the session is idle between two turns, so that the board can hand it work. A
    /// running session that is not is working on something.
    pub waiting: bool,
    /// What a working session waits on: the subagents and background commands that started and
    /// have not ended. Empty while it is idle.
    pub background_tasks: Vec<String>,
    /// Items the board pushed several times without the session handling them, and gave up on.
    pub push_stalled: Vec<Stalled>,
    /// Restarts since the last launch or stop by a person.
    pub restart_count: u32,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub last_exit_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub next_restart_at: Option<DateTime<Utc>>,
    pub auto_start: Option<AutoStart>,
}

/// The live child of the slot: its tool, launch ID, push state, and driver.
type LiveChild = (Tool, String, Arc<push::Push>, Arc<dyn AgentDriver>);

impl Launcher {
    /// The health of the one session slot. `tool` is `None` while nothing is launched.
    pub fn health(&self) -> Health {
        let auto_start = self.autostart.get();
        // The live set is read before the plans: the launcher takes them in the other order.
        let live: Option<LiveChild> = self.lock().iter().next().map(|(tool, live)| {
            (
                *tool,
                live.launch_id.clone(),
                live.push.clone(),
                live.driver.clone(),
            )
        });
        let plans = self.plans();
        let Some((tool, plan)) = plans.iter().next() else {
            return Health {
                tool: None,
                state: HealthState::Stopped,
                project_id: None,
                model: None,
                reason: None,
                waiting: false,
                background_tasks: Vec::new(),
                push_stalled: Vec::new(),
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
            waiting: matches!(plan.state, PlanState::Running)
                && plan.attached.is_some()
                && live
                    .as_ref()
                    .is_some_and(|(_, id, _, driver)| *id == plan.launch_id && driver.is_idle()),
            background_tasks: live
                .as_ref()
                .filter(|(_, id, _, _)| *id == plan.launch_id)
                .filter(|(_, _, _, driver)| !driver.is_idle())
                .map(|(_, _, _, driver)| driver.background_tasks())
                .unwrap_or_default(),
            push_stalled: live
                .as_ref()
                .filter(|(_, id, _, _)| *id == plan.launch_id)
                .map(|(_, _, push, _)| push.stalled())
                .unwrap_or_default(),
            restart_count: plan.restarts,
            last_exit_at: plan.last_exit_at,
            next_restart_at,
            auto_start,
        }
    }
}
