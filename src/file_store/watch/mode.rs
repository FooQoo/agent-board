//! How the shared folder is watched: the platform's file events, or a poll.

use std::time::Duration;

/// How often [`WatchMode::Poll`] scans the shared folder.
pub const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// How the shared folder is watched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WatchMode {
    /// The platform's file events (FSEvents on macOS). `agboard serve` uses this.
    #[default]
    Native,
    /// Scan the folder every [`POLL_INTERVAL`]. It starts at once without the platform's
    /// event service, whose registration can take many seconds on a busy Mac; the tests use it.
    Poll,
}

impl WatchMode {
    /// The mode named by `AGBOARD_WATCH`: `poll` selects [`WatchMode::Poll`]; anything else,
    /// or no value, is [`WatchMode::Native`].
    pub fn from_env() -> WatchMode {
        match std::env::var("AGBOARD_WATCH") {
            Ok(value) if value.eq_ignore_ascii_case("poll") => WatchMode::Poll,
            _ => WatchMode::Native,
        }
    }
}
