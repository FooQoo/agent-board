//! The task that follows the clock and records a summary each time a window ends.

use std::collections::HashMap;
use std::sync::{Arc, Weak};

use chrono::{DateTime, Utc};

use super::{CHECK_EVERY, Schedule, record_from_files};
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::file_store::notify::Summary;
use crate::server::AppState;
use crate::server::push_delivery::deliver::Dispatcher;

/// A window one project has not recorded yet: where it started for a project with no stored
/// summary, where it ends, and the entrance state when it first became due. All stay fixed across
/// retries, so a retry writes the same window and a result is never left between two windows.
#[derive(Clone, Copy)]
pub(super) struct Pending {
    pub(super) floor: DateTime<Utc>,
    pub(super) to: DateTime<Utc>,
    pub(super) entrance_up: bool,
}

/// The projects the index holds. Their tasks are read from the files when a window closes: the
/// index lags a save by the watcher delay, so a result recorded just before the end of a window
/// could be missing from it, and the next window would not take it back.
fn project_ids(state: &AppState) -> Vec<ProjectId> {
    let index = state.index.read().unwrap_or_else(|e| e.into_inner());
    index.entries().map(|(id, _)| id.clone()).collect()
}

/// Record the windows of these projects. Returns the summaries written and the projects that
/// could not be read or written.
pub(super) async fn record_all(
    shared: std::path::PathBuf,
    windows: Vec<(ProjectId, Pending)>,
) -> Option<(Vec<(String, Summary, bool)>, Vec<(ProjectId, Pending)>)> {
    tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&shared);
        let mut written = Vec::new();
        let mut failed = Vec::new();
        for (id, w) in windows {
            match record_from_files(&store, &id, w.floor, w.to) {
                Ok(Some(s)) => written.push((id.to_string(), s, w.entrance_up)),
                Ok(None) => {}
                Err(()) => failed.push((id, w)),
            }
        }
        (written, failed)
    })
    .await
    .ok()
}

/// Add the window that ends now for the projects that are not retrying an earlier one. A project
/// that recovered from an earlier window continues from that window's end, not from the shared
/// floor.
pub(super) fn add_new_windows(
    windows: &mut Vec<(ProjectId, Pending)>,
    window: Pending,
    projects: Vec<ProjectId>,
    resume: &mut HashMap<ProjectId, DateTime<Utc>>,
) {
    let retrying: Vec<ProjectId> = windows.iter().map(|(id, _)| id.clone()).collect();
    for id in projects.into_iter().filter(|id| !retrying.contains(id)) {
        let floor = resume.remove(&id).unwrap_or(window.floor);
        windows.push((id, Pending { floor, ..window }));
    }
}

/// Follow the clock and record a summary each time a window ends. The task ends with the server.
///
/// A window closes for every project when it ends. A project that cannot be read or written is
/// kept in `pending` and tried again on each check with the same window, and is left out of the
/// later windows until it records that one, so it never blocks the others and the next window of
/// it starts where its newest stored summary ends.
pub(in crate::server::push_delivery) fn start(weak: Weak<AppState>, dispatcher: Arc<Dispatcher>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(CHECK_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        tick.tick().await;
        let mut schedule = Schedule::new((dispatcher.now)(), None);
        let mut pending: HashMap<ProjectId, Pending> = HashMap::new();
        let mut resume: HashMap<ProjectId, DateTime<Utc>> = HashMap::new();
        loop {
            tick.tick().await;
            let Some(state) = weak.upgrade() else { return };
            let now = (dispatcher.now)();
            let minutes = state.notification_settings.load().summary.interval_minutes;
            if minutes == 0 {
                // Off: counting starts again when it is switched on.
                schedule.restart(now);
                pending.clear();
                resume.clear();
                continue;
            }
            let mut windows: Vec<(ProjectId, Pending)> = pending.drain().collect();
            let retried = windows.clone();
            if let Some(end) = schedule.due(now, minutes) {
                let window = Pending {
                    floor: schedule.since(minutes),
                    to: end,
                    // Read when the window first becomes due, not on each retry or after the
                    // write: a notification that was due while the entrance was down is
                    // recorded, never sent after it comes back.
                    entrance_up: super::super::runtime::entrance_up(&state),
                };
                add_new_windows(&mut windows, window, project_ids(&state), &mut resume);
                schedule.mark(end);
            }
            if windows.is_empty() {
                continue;
            }
            let Some((written, failed)) = record_all(state.shared.clone(), windows).await else {
                continue;
            };
            // A retry that recovered with nothing to write stores no summary, so its end is
            // kept: the project's next window starts there, not at the later shared floor.
            for (id, w) in &retried {
                if !failed.iter().any(|(f, _)| f == id) {
                    resume.insert(id.clone(), w.to);
                }
            }
            pending.extend(failed);
            for (project, summary, entrance_up) in &written {
                let ctx = super::super::runtime::context(&state, *entrance_up)
                    .filter(|ctx| ctx.settings.kinds.summary);
                if let Some(ctx) = ctx {
                    dispatcher.deliver_summary(&ctx, project, summary).await;
                }
            }
        }
    });
}
