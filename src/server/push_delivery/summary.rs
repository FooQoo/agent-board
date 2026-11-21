//! The periodic summary: every configured interval, the server records the results of each
//! project's last window in its `notify/` folder (see `file_store::notify`) and, when the summary
//! kind is on, tells the phones that a summary arrived.
//!
//! Nothing here reads a model: a summary is the list of results the board already holds. The
//! window ends on a clean boundary of the local clock (every hour on the hour for a 60-minute
//! interval), so a restart does not write one at once and the times read the same on every run. A window that no result falls in writes nothing
//! and sends nothing. The next window of a project begins where its newest stored summary ends,
//! so a restart never reports a result twice.

use std::time::Duration;

use chrono::{DateTime, Local, NaiveTime, TimeZone, Timelike, Utc};

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

/// The latest clean boundary at or before `at`, on the wall clock of `zone`: a multiple of
/// `minutes` after local midnight, so a 60-minute interval gives windows on the hour and a
/// 240-minute one gives 00:00, 04:00, 08:00, and so on. Every offered interval divides a day, so
/// the boundaries restart at each local midnight and never drift across a day or a zone change.
/// Across a daylight-saving change the wall clock is kept: a boundary that does not exist is
/// moved back to the last one that does, and a repeated one takes the later of its two instants
/// that is not after `at`.
pub(super) fn clock_floor<Tz: TimeZone>(
    at: DateTime<Utc>,
    minutes: u32,
    zone: &Tz,
) -> DateTime<Utc> {
    let step = i64::from(minutes.max(1));
    let local = at.with_timezone(zone).naive_local();
    let since_midnight = i64::from(local.time().num_seconds_from_midnight()) / 60;
    let mut naive = local.date().and_time(NaiveTime::MIN)
        + chrono::Duration::minutes(since_midnight - since_midnight % step);
    // A wall-clock time the zone skips has no instant; step back to the one before the gap.
    loop {
        let found = zone
            .from_local_datetime(&naive)
            .earliest()
            .into_iter()
            .chain(zone.from_local_datetime(&naive).latest())
            .map(|d| d.with_timezone(&Utc))
            .filter(|d| *d <= at)
            .max();
        if let Some(d) = found {
            return d;
        }
        naive -= chrono::Duration::minutes(step);
    }
}

/// When the next window ends. Windows end on clean boundaries of the local clock (see
/// [`clock_floor`]), not an interval after the start of the server.
pub(super) struct Schedule {
    /// The end of the last window, always a clean boundary.
    last: Option<DateTime<Utc>>,
    started: DateTime<Utc>,
}

impl Schedule {
    pub(super) fn new(started: DateTime<Utc>, last: Option<DateTime<Utc>>) -> Self {
        Self { last, started }
    }

    /// The end of the newest window, or the boundary the server started in.
    fn edge<Tz: TimeZone>(&self, minutes: u32, zone: &Tz) -> DateTime<Utc> {
        self.last
            .unwrap_or_else(|| clock_floor(self.started, minutes, zone))
    }

    /// The boundary a window ends on now, when one has passed since the last window.
    pub(super) fn due_in<Tz: TimeZone>(
        &self,
        now: DateTime<Utc>,
        minutes: u32,
        zone: &Tz,
    ) -> Option<DateTime<Utc>> {
        let end = clock_floor(now, minutes, zone);
        (end > self.edge(minutes, zone)).then_some(end)
    }

    /// The start of the window: the end of the last one, or, for the first, the boundary before
    /// the one the server started in, so the interval before the start is covered.
    pub(super) fn since_in<Tz: TimeZone>(&self, minutes: u32, zone: &Tz) -> DateTime<Utc> {
        self.last.unwrap_or_else(|| {
            let edge = clock_floor(self.started, minutes, zone);
            clock_floor(edge - chrono::Duration::seconds(1), minutes, zone)
        })
    }

    pub(super) fn due(&self, now: DateTime<Utc>, minutes: u32) -> Option<DateTime<Utc>> {
        self.due_in(now, minutes, &Local)
    }

    pub(super) fn since(&self, minutes: u32) -> DateTime<Utc> {
        self.since_in(minutes, &Local)
    }

    /// Record the window that ended on `end`.
    pub(super) fn mark(&mut self, end: DateTime<Utc>) {
        self.last = Some(end);
    }

    /// Counting starts again from `now`, as when the summary is switched back on.
    pub(super) fn restart(&mut self, now: DateTime<Utc>) {
        self.last = None;
        self.started = now;
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
