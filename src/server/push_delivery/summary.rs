//! The periodic summary: every configured interval, the server records the results of each
//! project's last window in its `notify/` folder (see `file_store::notify`) and, when the summary
//! kind is on, tells the phones that a summary arrived.
//!
//! Nothing here reads a model: a summary is the list of results the board already holds. The
//! interval counts from the last window, or from the start of the server when there has not been
//! one, so a restart does not write one at once. A window that no result falls in writes nothing
//! and sends nothing. The next window of a project begins where its newest stored summary ends,
//! so a restart never reports a result twice.

use std::time::Duration;

use chrono::{DateTime, Local, Utc};

use super::message::{Lang, Payload, shorten};
use crate::domain::ProjectId;
use crate::file_store::FileStore;
use crate::file_store::model::TaskView;
use crate::file_store::notify::Summary;
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
/// cannot be read, or that has a task whose `task.json` cannot be read, is an `Err`, retried like
/// a failed write.
pub(super) fn record_from_files(
    store: &FileStore,
    project: &ProjectId,
    floor: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Option<Summary>, ()> {
    let snapshot = store.snapshot(project).map_err(|_| ())?;
    // The snapshot leaves out a task whose `task.json` cannot be read and reports it as a
    // problem. Its results are unknown, so the window is not closed for the project: writing it
    // would move the boundary past results that the task holds.
    if snapshot
        .problems
        .iter()
        .any(|p| p.file.ends_with("task.json"))
    {
        return Err(());
    }
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

mod run;
pub(super) use run::start;

#[cfg(test)]
mod tests;
