//! What keeps launches, stops and deferred starts from overlapping: the launch gate, and the
//! epoch that a deferred start or restart must still be current under.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, MutexGuard};

use super::spawn::Spawn;
use super::{Launched, Launcher};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::sessions::Tool;

impl Launcher {
    pub(super) fn gate(&self) -> MutexGuard<'_, ()> {
        self.gate.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The current epoch; see the field.
    pub(super) fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }

    /// Forget every plan and end the epoch, so nothing prepared under it is admitted any more.
    pub(super) fn reset_plans(&self) {
        let mut plans = self.plans();
        plans.clear();
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// The start of the saved auto-start: a launch that is admitted only while `epoch` (read with
    /// [`Launcher::epoch`] before the project was resolved) is still current, so a stop or another
    /// launch in the meantime cancels it.
    pub(super) fn launch_auto(
        self: &Arc<Self>,
        epoch: u64,
        project: &ProjectId,
        project_name: &str,
        folder: &Path,
        tool: Tool,
        model: Option<&str>,
    ) -> Result<Launched, AgboardError> {
        self.spawn_child(
            project,
            project_name,
            folder,
            tool,
            model,
            Spawn::Auto(epoch),
        )
    }
}
