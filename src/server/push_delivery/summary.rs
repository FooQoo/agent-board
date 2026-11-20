//! The periodic summary: every configured interval, the server records the results of each
//! project's last window in its `notify/` folder (see `file_store::notify`) and, when the summary
//! kind is on, tells the phones that a summary arrived.
//!
//! Nothing here reads a model: a summary is the list of results the board already holds. The
//! interval counts from the last window, or from the start of the server when there has not been
//! one, so a restart does not write one at once. A window that no result falls in writes nothing
//! and sends nothing. The next window of a project begins where its newest stored summary ends,
//! so a restart never reports a result twice.

use std::collections::HashSet;
use std::sync::{Arc, Weak};
use std::time::Duration;

use chrono::{DateTime, Local, Utc};

use super::deliver::{Context, Dispatcher};
use super::message::{Lang, Payload, shorten};
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::file_store::model::TaskView;
use crate::file_store::notify::Summary;
use crate::server::AppState;
use crate::server::monitor_connection::contracts::PublicOrigin;

/// How often the task checks whether a window is due.
const CHECK_EVERY: Duration = Duration::from_secs(30);
/// How many titles the message body lists; the rest are counted.
const MAX_TITLES: usize = 3;
const TITLE_CHARS: usize = 40;

/// When the next window ends.
pub(super) struct Schedule {
    last: Option<DateTime<Utc>>,
    started: DateTime<Utc>,
}

impl Schedule {
    pub(super) fn new(started: DateTime<Utc>, last: Option<DateTime<Utc>>) -> Self {
        Self { last, started }
    }

    fn interval(minutes: u32) -> chrono::Duration {
        chrono::Duration::minutes(i64::from(minutes))
    }

    pub(super) fn due(&self, now: DateTime<Utc>, minutes: u32) -> bool {
        now >= self.last.unwrap_or(self.started) + Self::interval(minutes)
    }

    /// The start of the window that ends now: the end of the last one, or, for the first, one
    /// interval before the start of the server.
    pub(super) fn since(&self, minutes: u32) -> DateTime<Utc> {
        self.last.unwrap_or(self.started - Self::interval(minutes))
    }

    pub(super) fn mark(&mut self, now: DateTime<Utc>) {
        self.last = Some(now);
    }
}

/// Write the summary of the window ending at `to` for one project. The window starts at the end
/// of the newest stored summary, or at `floor` when the project has none, so a restart or a failed
/// earlier write leaves no gap. `Ok(None)` when no result falls in it or the summary is already
/// stored; `Err` when the write failed, so the caller retries the window.
pub(super) fn record(
    store: &FileStore,
    project: &ProjectId,
    tasks: &[TaskView],
    floor: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Option<Summary>, ()> {
    let from = store.latest_summary_end(project).unwrap_or(floor);
    let Some(summary) = Summary::for_window(tasks, from, to) else {
        return Ok(None);
    };
    match store.append_summary(project, &summary) {
        Ok(stored) => Ok(stored.then_some(summary)),
        Err(_) => Err(()),
    }
}

/// [`record`] over the tasks as the files hold them now, not as the index does. A project that
/// cannot be read is an `Err`, retried like a failed write.
pub(super) fn record_from_files(
    store: &FileStore,
    project: &ProjectId,
    floor: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Option<Summary>, ()> {
    let snapshot = store.snapshot(project).map_err(|_| ())?;
    record(store, project, &snapshot.tasks, floor, to)
}

fn clock(at: DateTime<Utc>) -> String {
    at.with_timezone(&Local).format("%H:%M").to_string()
}

/// The message for a summary. `None` when the project id is not one the board makes.
pub(super) fn payload_of(
    project: &str,
    summary: &Summary,
    lang: Lang,
    origin: &PublicOrigin,
) -> Option<Payload> {
    let link = format!("{}&messages=summary", origin.project_link(project)?);
    let n = summary.results.len();
    let mut titles: Vec<String> = summary
        .results
        .iter()
        .take(MAX_TITLES)
        .map(|r| shorten(&r.title, TITLE_CHARS))
        .collect();
    let more = n.saturating_sub(MAX_TITLES);
    let window = format!("{}-{}", clock(summary.from), clock(summary.to));
    let (title, body) = match lang {
        Lang::Ja => {
            if more > 0 {
                titles.push(format!("ほか{more}件"));
            }
            (
                format!("サマリー {window}"),
                format!("成果が{n}件: {}", titles.join("、")),
            )
        }
        Lang::En => {
            if more > 0 {
                titles.push(format!("and {more} more"));
            }
            (
                format!("Summary {window}"),
                format!(
                    "{n} result{}: {}",
                    if n == 1 { "" } else { "s" },
                    titles.join("; ")
                ),
            )
        }
    };
    Some(Payload {
        title,
        body,
        path: link.strip_prefix(origin.origin())?.to_string(),
        tag: format!("summary:{project}:{}", summary.id),
        urgent: false,
    })
}

/// The projects the index holds. Their tasks are read from the files when a window closes: the
/// index lags a save by the watcher delay, so a result recorded just before the end of a window
/// could be missing from it, and the next window would not take it back.
fn project_ids(state: &AppState) -> Vec<ProjectId> {
    let index = state.index.read().unwrap_or_else(|e| e.into_inner());
    index.entries().map(|(id, _)| id.clone()).collect()
}

/// Follow the clock and record a summary each time a window ends. The task ends with the server.
pub(super) fn start(weak: Weak<AppState>, dispatcher: Arc<Dispatcher>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(CHECK_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        tick.tick().await;
        let mut schedule = Schedule::new((dispatcher.now)(), None);
        // For the open window: when it ends, the entrance state when it first became due, and
        // the projects that already recorded it. All are fixed when the window first becomes due,
        // kept across retries, and cleared when it closes. Because the end is fixed, a retry
        // writes the same window, never a shorter one, and the next window starts at that end,
        // so a result is never left between two windows.
        let mut open_to: Option<DateTime<Utc>> = None;
        let mut due_up: Option<bool> = None;
        let mut done: HashSet<ProjectId> = HashSet::new();
        loop {
            tick.tick().await;
            let Some(state) = weak.upgrade() else { return };
            let now = (dispatcher.now)();
            let minutes = state.notification_settings.load().summary.interval_minutes;
            if minutes == 0 {
                // Off: counting starts again when it is switched on.
                schedule.mark(now);
                open_to = None;
                due_up = None;
                done.clear();
                continue;
            }
            if !schedule.due(now, minutes) {
                continue;
            }
            let floor = schedule.since(minutes);
            let to = *open_to.get_or_insert(now);
            // Read when the window first becomes due, not on each retry or after the write: a
            // notification that was due while the entrance was down is recorded, never sent
            // after it comes back.
            let entrance_up = *due_up.get_or_insert_with(|| super::runtime::entrance_up(&state));
            let mut projects = project_ids(&state);
            projects.retain(|id| !done.contains(id));
            let shared = state.shared.clone();
            let written = tokio::task::spawn_blocking(move || {
                let store = FileStore::open(&shared);
                let mut failed = false;
                let mut recorded = Vec::new();
                let mut written = Vec::new();
                for id in &projects {
                    match record_from_files(&store, id, floor, to) {
                        Ok(summary) => {
                            recorded.push(id.clone());
                            if let Some(s) = summary {
                                written.push((id.to_string(), s));
                            }
                        }
                        Err(()) => failed = true,
                    }
                }
                (written, recorded, failed)
            })
            .await;
            // A failed write leaves the window open and the next check tries it again, but only
            // for the projects that have not recorded it: one that has is not given a short
            // window of its own.
            let Ok((written, recorded, failed)) = written else {
                continue;
            };
            done.extend(recorded);
            if !failed {
                schedule.mark(to);
                open_to = None;
                due_up = None;
                done.clear();
            }
            if written.is_empty() {
                continue;
            }
            let ctx: Option<Context> = super::runtime::context(&state, entrance_up)
                .filter(|ctx| ctx.settings.kinds.summary);
            drop(state);
            if let Some(ctx) = ctx {
                for (project, summary) in &written {
                    dispatcher.deliver_summary(&ctx, project, summary).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests;
