//! The launcher's view of the board: where the boards are, waking the pusher when one changes,
//! and the launched session as the sessions list shows it.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::broadcast;

use super::Launcher;
use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::server::change_feed::ChangeFeed;
use crate::server::sessions::{Origin, SessionView, State, Tool};

impl Launcher {
    /// Tell the launcher where the boards are, so that it can push work to the session it
    /// launched. Without it nothing is pushed.
    pub fn attach_board(&self, shared: &Path) {
        *self.board.lock().unwrap_or_else(|e| e.into_inner()) = Some(shared.to_path_buf());
        self.nudge();
    }

    pub(super) fn board_dir(&self) -> Option<PathBuf> {
        self.board.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// The session stopped on an error with `tasks` in hand: each one it left running gets one
    /// history entry that another agent has to take it over, and goes back to idle. Nothing here
    /// can fail the session's own bookkeeping: a task that cannot be saved is left as it is.
    pub(super) fn hand_over(&self, project: &ProjectId, tasks: &[i64], detail: &str) {
        if tasks.is_empty() || self.is_closing() {
            return;
        }
        let Some(shared) = self.board_dir() else {
            return;
        };
        let store = FileStore::open(&shared);
        for id in tasks {
            let _ = store.record_agent_stopped(project, *id, detail, SystemClock.now());
        }
    }

    /// Whether the supervisor still keeps `launch_id` as the running child of `tool`. A stop by a
    /// person clears the plan, so a session that was stopped on purpose is not an error.
    pub(super) fn is_current_plan(&self, tool: Tool, launch_id: &str) -> bool {
        self.plans()
            .get(&tool)
            .is_some_and(|plan| plan.launch_id == launch_id)
    }

    /// The board changed: let the launched session look at it if it is idle.
    pub fn nudge(&self) {
        for live in self.lock().values() {
            live.push.nudge();
        }
    }

    /// The launched session of `project` as a listed session, once it reported its first event:
    /// connected while it is idle (it waits for the board), counted in grace while it works.
    pub fn board_session(&self, project: &ProjectId) -> Option<SessionView> {
        let found = {
            let live = self.lock();
            live.iter()
                .find(|(_, live)| &live.project == project)
                .map(|(tool, live)| {
                    (
                        *tool,
                        live.launch_id.clone(),
                        live.push.clone(),
                        live.driver.clone(),
                    )
                })
        };
        let (tool, launch_id, push, driver) = found?;
        let connected_at = push.attached_at()?;
        let now = SystemClock.now();
        let idle = driver.is_idle();
        Some(SessionView {
            id: format!("resident:{launch_id}"),
            tool,
            origin: Origin::Board,
            connected_at,
            last_seen_at: now,
            state: if idle { State::Connected } else { State::Grace },
        })
    }

    /// Start pushing: tell the launcher where the boards are, and wake the launched session
    /// whenever the board changes, so that it is handed new work at once instead of at its next
    /// look. Call it inside the server's runtime.
    pub(crate) fn watch_board(self: &Arc<Self>, shared: &Path, feed: &ChangeFeed) {
        self.attach_board(shared);
        let mut changes = feed.subscribe();
        let launcher = self.clone();
        tokio::spawn(async move {
            loop {
                match changes.recv().await {
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => launcher.nudge(),
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        });
    }
}
