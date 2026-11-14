//! How long the server has gone without use, so that a server the CLI started
//! by itself can stop once nobody needs it.
//!
//! A request (except `GET /api/health`), a change the watcher saw, an open
//! event stream and a mobile monitor connection all count as use. The decision
//! to stop and the acceptance of new requests share one lock: once the server
//! has decided to stop, every new request is refused.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use super::response::error_response;

/// The idle stop of an automatic server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdleStop {
    /// How long the server may go without use.
    pub timeout: Duration,
    /// How often the server checks.
    pub check_every: Duration,
}

/// The shortest and longest idle time `AGBOARD_IDLE_TIMEOUT` may set, in seconds.
pub const IDLE_TIMEOUT_RANGE: std::ops::RangeInclusive<u64> = 60..=86_400;

/// The idle time when `AGBOARD_IDLE_TIMEOUT` is unset or not usable: 30 minutes.
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// How often an automatic server checks whether it is still used.
pub const DEFAULT_CHECK_EVERY: Duration = Duration::from_secs(30);

impl IdleStop {
    /// The idle stop from `AGBOARD_IDLE_TIMEOUT` (seconds) and, for tests,
    /// `AGBOARD_IDLE_CHECK_MS`. A value that is not a whole number in range is
    /// ignored and the default is used.
    pub fn from_env(env: &dyn Fn(&str) -> Option<String>) -> IdleStop {
        let timeout = env("AGBOARD_IDLE_TIMEOUT")
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|seconds| IDLE_TIMEOUT_RANGE.contains(seconds))
            .map_or(DEFAULT_IDLE_TIMEOUT, Duration::from_secs);
        let check_every = env("AGBOARD_IDLE_CHECK_MS")
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|ms| *ms > 0)
            .map_or(DEFAULT_CHECK_EVERY, Duration::from_millis)
            .min(DEFAULT_CHECK_EVERY);
        IdleStop {
            timeout,
            check_every,
        }
    }
}

/// "30 minutes", "1 minute", "90 seconds": the idle time as people read it.
pub fn describe(timeout: Duration) -> String {
    let seconds = timeout.as_secs();
    match (seconds % 60, seconds / 60) {
        (0, 1) => "1 minute".to_string(),
        (0, minutes) => format!("{minutes} minutes"),
        _ => format!("{seconds} seconds"),
    }
}

struct Usage {
    last_used: Instant,
    open_streams: usize,
    /// A board page in a browser has opened an event stream since the start.
    board_seen: bool,
    stopping: bool,
}

/// When the server was last used, and whether it has decided to stop.
pub(crate) struct Activity {
    usage: Mutex<Usage>,
}

impl Activity {
    pub(crate) fn new() -> Arc<Activity> {
        Arc::new(Activity {
            usage: Mutex::new(Usage {
                last_used: Instant::now(),
                open_streams: 0,
                board_seen: false,
                stopping: false,
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Usage> {
        self.usage.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Count a use at `now`. `false` once the server has decided to stop.
    pub(crate) fn touch_at(&self, now: Instant) -> bool {
        let mut usage = self.lock();
        if usage.stopping {
            return false;
        }
        usage.last_used = usage.last_used.max(now);
        true
    }

    pub(crate) fn touch(&self) -> bool {
        self.touch_at(Instant::now())
    }

    /// Count an open event stream until the returned hold is dropped. `board`
    /// says that a board page opened it, not a command that waits.
    pub(crate) fn open_stream(self: &Arc<Self>, board: bool) -> StreamHold {
        let mut usage = self.lock();
        usage.open_streams += 1;
        usage.board_seen |= board;
        drop(usage);
        StreamHold(self.clone())
    }

    /// Whether a board page has connected since the server started.
    pub(crate) fn board_seen(&self) -> bool {
        self.lock().board_seen
    }

    /// Whether to stop at `now`. Open streams and `busy` (a mobile monitor
    /// connection) are use for as long as they last. A `true` is final: from
    /// then on every request is refused.
    pub(crate) fn decide_stop(&self, now: Instant, timeout: Duration, busy: bool) -> bool {
        let mut usage = self.lock();
        if usage.stopping {
            return true;
        }
        if busy || usage.open_streams > 0 {
            usage.last_used = usage.last_used.max(now);
            return false;
        }
        if now.saturating_duration_since(usage.last_used) >= timeout {
            usage.stopping = true;
        }
        usage.stopping
    }
}

/// An open event stream. Closing it is the last moment of its use.
pub(crate) struct StreamHold(Arc<Activity>);

impl Drop for StreamHold {
    fn drop(&mut self) {
        let mut usage = self.0.lock();
        usage.open_streams = usage.open_streams.saturating_sub(1);
        usage.last_used = usage.last_used.max(Instant::now());
    }
}

/// Count every request but the health check, and refuse requests once the
/// server has decided to stop.
pub(crate) async fn track(
    State(activity): State<Arc<Activity>>,
    request: Request,
    next: Next,
) -> Response {
    let health = request.method() == Method::GET && request.uri().path() == "/api/health";
    if !health && !activity.touch() {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "board_unavailable",
            "the board is unavailable.",
            "The server is stopping because it was not used. Try again.",
        );
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMEOUT: Duration = Duration::from_secs(60);

    #[test]
    fn the_server_stops_only_after_the_whole_idle_time_without_use() {
        let activity = Activity::new();
        let start = Instant::now();
        activity.touch_at(start);
        assert!(!activity.decide_stop(start + Duration::from_secs(59), TIMEOUT, false));
        assert!(activity.decide_stop(start + TIMEOUT, TIMEOUT, false));
        // Decided: nothing is accepted any more.
        assert!(!activity.touch_at(start + TIMEOUT));
        assert!(activity.decide_stop(start + TIMEOUT, TIMEOUT, false));
    }

    #[test]
    fn a_use_starts_the_idle_time_again() {
        let activity = Activity::new();
        let start = Instant::now();
        activity.touch_at(start);
        assert!(activity.touch_at(start + Duration::from_secs(50)));
        assert!(!activity.decide_stop(start + Duration::from_secs(100), TIMEOUT, false));
        assert!(activity.decide_stop(start + Duration::from_secs(110), TIMEOUT, false));
    }

    #[test]
    fn an_open_stream_keeps_the_server_running_and_its_close_counts_as_use() {
        let activity = Activity::new();
        let start = Instant::now();
        let stream = activity.open_stream(true);
        let far = start + Duration::from_secs(3600);
        assert!(!activity.decide_stop(far, TIMEOUT, false));
        drop(stream);
        // The idle time counts from the close, not from the start.
        assert!(!activity.decide_stop(far + Duration::from_secs(30), TIMEOUT, false));
        assert!(activity.decide_stop(far + TIMEOUT, TIMEOUT, false));
    }

    #[test]
    fn only_a_board_page_counts_as_a_connected_board() {
        let activity = Activity::new();
        assert!(!activity.board_seen());
        let wait = activity.open_stream(false);
        assert!(
            !activity.board_seen(),
            "a waiting command is not a board page"
        );
        drop(wait);
        drop(activity.open_stream(true));
        // A page that connected and left still counts: it may reconnect.
        assert!(activity.board_seen());
    }

    #[test]
    fn a_monitor_connection_keeps_the_server_running() {
        let activity = Activity::new();
        let start = Instant::now();
        let far = start + Duration::from_secs(3600);
        assert!(!activity.decide_stop(far, TIMEOUT, true));
        assert!(!activity.decide_stop(far + Duration::from_secs(59), TIMEOUT, false));
        assert!(activity.decide_stop(far + TIMEOUT, TIMEOUT, false));
    }

    #[test]
    fn the_idle_time_comes_from_the_environment_within_its_range() {
        let with = |value: &'static str| {
            IdleStop::from_env(&move |name| (name == "AGBOARD_IDLE_TIMEOUT").then(|| value.into()))
        };
        assert_eq!(IdleStop::from_env(&|_| None).timeout, DEFAULT_IDLE_TIMEOUT);
        assert_eq!(with("60").timeout, Duration::from_secs(60));
        assert_eq!(with("86400").timeout, Duration::from_secs(86_400));
        for bad in ["59", "86401", "abc", "", "-5"] {
            assert_eq!(with(bad).timeout, DEFAULT_IDLE_TIMEOUT, "{bad:?}");
        }
        assert_eq!(
            IdleStop::from_env(&|_| None).check_every,
            DEFAULT_CHECK_EVERY
        );
        let quick =
            IdleStop::from_env(&|name| (name == "AGBOARD_IDLE_CHECK_MS").then(|| "200".into()));
        assert_eq!(quick.check_every, Duration::from_millis(200));
    }

    #[test]
    fn the_idle_time_reads_as_minutes_or_seconds() {
        assert_eq!(describe(DEFAULT_IDLE_TIMEOUT), "30 minutes");
        assert_eq!(describe(Duration::from_secs(60)), "1 minute");
        assert_eq!(describe(Duration::from_secs(90)), "90 seconds");
    }
}
