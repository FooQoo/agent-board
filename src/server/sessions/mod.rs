//! The agent sessions attached to the board.
//!
//! A session counts in two ways. While a `wait --until task` command of it holds an event stream
//! open, it is connected; when the stream closes it is kept for a grace period, so the gap
//! between one wait and the next does not make the count flicker. An external session (one the
//! board did not launch) also counts for [`ACCESS_WINDOW`] after any `agboard` command or hook
//! of it reached the server with [`SessionRegistry::touch`], whether or not it waits. The
//! commands name the session with the headers in `model`. The registry lives in memory only: a
//! server that restarts starts with no sessions, and the next wait or command registers again.

mod model;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

use crate::clock::{Clock, SystemClock};
use crate::domain::ProjectId;

pub use model::*;

type Id = (ProjectId, String);

struct Entry {
    tool: Tool,
    origin: Origin,
    connected_at: DateTime<Utc>,
    last_seen_at: DateTime<Utc>,
    /// Open streams of the session. A second wait can overlap the end of the first.
    streams: usize,
    /// When the last stream closed.
    released_at: Option<Instant>,
    /// When an `agboard` command or hook of the session last reached the server.
    touched_at: Option<Instant>,
}

impl Entry {
    /// Whether the session still counts at `now`: a stream is open, or the grace period after the
    /// last stream, or the access window after the last access, has not ended.
    fn counts(&self, now: Instant, grace: Duration) -> bool {
        let within = |at: Option<Instant>, limit: Duration| {
            at.is_some_and(|at| now.saturating_duration_since(at) < limit)
        };
        self.streams > 0
            || within(self.released_at, grace)
            || within(self.touched_at, ACCESS_WINDOW)
    }
}

/// The sessions attached to this server.
pub struct SessionRegistry {
    grace: Duration,
    entries: Mutex<HashMap<Id, Entry>>,
}

impl SessionRegistry {
    pub fn new(grace: Duration) -> Arc<SessionRegistry> {
        Arc::new(SessionRegistry {
            grace,
            entries: Mutex::new(HashMap::new()),
        })
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<Id, Entry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn prune(&self, entries: &mut HashMap<Id, Entry>, now: Instant) {
        entries.retain(|_, entry| entry.counts(now, self.grace));
    }

    /// Count the session until the returned hold is dropped. A session that is already counted
    /// (connected, or in grace) stays one session and keeps its first `connectedAt`.
    pub fn register(self: &Arc<Self>, attributes: Attributes) -> SessionHold {
        self.register_at(attributes, Instant::now(), SystemClock.now())
    }

    fn register_at(
        self: &Arc<Self>,
        attributes: Attributes,
        now: Instant,
        wall: DateTime<Utc>,
    ) -> SessionHold {
        let id = (attributes.project, attributes.key);
        let mut entries = self.lock();
        self.prune(&mut entries, now);
        let entry = entries.entry(id.clone()).or_insert_with(|| Entry {
            tool: attributes.tool,
            origin: attributes.origin,
            connected_at: wall,
            last_seen_at: wall,
            streams: 0,
            released_at: None,
            touched_at: None,
        });
        entry.tool = attributes.tool;
        entry.origin = attributes.origin;
        entry.last_seen_at = wall;
        entry.streams += 1;
        entry.released_at = None;
        drop(entries);
        SessionHold {
            registry: self.clone(),
            id,
            released: false,
        }
    }

    /// Record that an `agboard` command or hook of an external session reached the server now.
    /// The session counts for [`ACCESS_WINDOW`] from this call, on top of any open stream. A
    /// board-launched session is ignored: the launcher counts it itself, so it is never counted
    /// twice. A session that is already counted keeps its first `connectedAt`.
    pub fn touch(&self, attributes: Attributes) {
        self.touch_at(attributes, Instant::now(), SystemClock.now());
    }

    fn touch_at(&self, attributes: Attributes, now: Instant, wall: DateTime<Utc>) {
        if attributes.origin == Origin::Board {
            return;
        }
        let id = (attributes.project, attributes.key);
        let mut entries = self.lock();
        self.prune(&mut entries, now);
        let entry = entries.entry(id).or_insert_with(|| Entry {
            tool: attributes.tool,
            origin: Origin::External,
            connected_at: wall,
            last_seen_at: wall,
            streams: 0,
            released_at: None,
            touched_at: None,
        });
        if entry.origin == Origin::Board {
            return;
        }
        entry.tool = attributes.tool;
        entry.last_seen_at = wall;
        entry.touched_at = Some(now);
    }

    fn release(&self, id: &Id, now: Instant, wall: DateTime<Utc>) {
        let mut entries = self.lock();
        if let Some(entry) = entries.get_mut(id) {
            entry.streams = entry.streams.saturating_sub(1);
            if entry.streams == 0 {
                entry.released_at = Some(now);
                entry.last_seen_at = wall;
            }
        }
    }

    /// The sessions of `project` that count now, oldest first, with their counts.
    pub fn list(&self, project: &ProjectId) -> SessionList {
        self.list_at(project, Instant::now(), SystemClock.now())
    }

    fn list_at(&self, project: &ProjectId, now: Instant, wall: DateTime<Utc>) -> SessionList {
        let mut entries = self.lock();
        self.prune(&mut entries, now);
        let mut sessions: Vec<SessionView> = entries
            .iter()
            .filter(|((owner, _), _)| owner == project)
            .map(|((_, key), entry)| view(key, entry, wall))
            .collect();
        sessions.sort_by(|a, b| (a.connected_at, &a.id).cmp(&(b.connected_at, &b.id)));
        let counts = Counts::of(&sessions);
        SessionList { sessions, counts }
    }

    /// Whether the board may launch a session. Board-launched sessions are limited to one in
    /// total, whichever tool; the error names the tool that holds the slot. External sessions
    /// are never limited. A board-launched session in grace still counts, so a launcher does not
    /// start a second one while the first is between two waits.
    pub fn check_board_launch(&self) -> Result<(), LaunchRefused> {
        let mut entries = self.lock();
        self.prune(&mut entries, Instant::now());
        match entries.values().find(|entry| entry.origin == Origin::Board) {
            Some(entry) => Err(LaunchRefused { tool: entry.tool }),
            None => Ok(()),
        }
    }

    /// Whether a board-launched session of `tool` counts now (connected, or in grace).
    pub fn has_board(&self, tool: Tool) -> bool {
        let mut entries = self.lock();
        self.prune(&mut entries, Instant::now());
        entries
            .values()
            .any(|entry| entry.origin == Origin::Board && entry.tool == tool)
    }

    /// Drop every board-launched session of `tool` from the count at once, without the grace
    /// period. The launcher calls it when it has stopped the process, or the process has exited,
    /// so that the next launch is not refused for a session that is gone.
    pub fn remove_board(&self, tool: Tool) {
        self.lock()
            .retain(|_, entry| !(entry.origin == Origin::Board && entry.tool == tool));
    }
}

fn view(key: &str, entry: &Entry, wall: DateTime<Utc>) -> SessionView {
    let connected = entry.streams > 0;
    SessionView {
        id: key.to_string(),
        tool: entry.tool,
        origin: entry.origin,
        connected_at: entry.connected_at,
        last_seen_at: if connected { wall } else { entry.last_seen_at },
        state: if connected {
            State::Connected
        } else {
            State::Grace
        },
    }
}

/// An open stream of a counted session. Dropping it starts the grace period.
pub struct SessionHold {
    registry: Arc<SessionRegistry>,
    id: Id,
    released: bool,
}

impl SessionHold {
    #[cfg(test)]
    fn release_at(mut self, now: Instant, wall: DateTime<Utc>) {
        self.released = true;
        self.registry.release(&self.id, now, wall);
    }
}

impl Drop for SessionHold {
    fn drop(&mut self) {
        if !self.released {
            self.registry
                .release(&self.id, Instant::now(), SystemClock.now());
        }
    }
}

#[cfg(test)]
mod tests;
