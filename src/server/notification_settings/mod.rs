//! Which notifications the phone receives, kept in the app's internal area as
//! `<data_dir>/.internal/notification-settings.json`. The file is the app's own
//! state, not a shared project file, so it is never in `shared/`.
//!
//! This module is the one definition of the kinds, their defaults, and the
//! periodic intervals. The Web Push delivery side reads the saved value with
//! [`NotificationSettingsStore::load`]. A missing, invalid, or unreadable file
//! reads as the defaults. A save replaces the whole file in one step, and a
//! failed save leaves the old file as it was.

pub(crate) mod http;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::preferences::{create_private_dir, sync_dir, write_owner_only};

/// The only file format this build reads and writes.
const FORMAT_VERSION: u32 = 1;
const INTERNAL_DIR: &str = ".internal";
const FILE_NAME: &str = "notification-settings.json";

/// The intervals of the periodic status notification, in minutes.
pub(crate) const PERIODIC_INTERVALS: [u32; 4] = [30, 60, 120, 240];
/// The interval a new file starts with.
pub(crate) const DEFAULT_INTERVAL_MINUTES: u32 = 60;

/// The four kinds of milestone notification. Each is switched on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Kinds {
    /// A result (an intermediate draft or a final) was recorded on a task.
    pub results: bool,
    /// A question needs the user's decision.
    pub questions: bool,
    /// A card changed state; `StateChanges` says which changes.
    pub state_changes: bool,
    /// A history entry was added to a task.
    pub history: bool,
}

/// Which state changes count when the `state_changes` kind is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StateChanges {
    /// A card started (it moved to doing).
    pub started: bool,
    /// A card is waiting for an answer.
    pub pending: bool,
    /// A card became done.
    pub done: bool,
}

/// The periodic status notification, separate from the milestone kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Periodic {
    pub enabled: bool,
    /// One of [`PERIODIC_INTERVALS`].
    pub interval_minutes: u32,
}

/// The saved notification settings as the API carries them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationSettings {
    pub kinds: Kinds,
    pub state_changes: StateChanges,
    pub periodic: Periodic,
    pub revision: u64,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            kinds: Kinds {
                results: true,
                questions: true,
                state_changes: false,
                history: false,
            },
            state_changes: StateChanges {
                started: true,
                pending: true,
                done: true,
            },
            periodic: Periodic {
                enabled: false,
                interval_minutes: DEFAULT_INTERVAL_MINUTES,
            },
            revision: 0,
        }
    }
}

impl NotificationSettings {
    /// Whether a state change to `started`, `pending`, or `done` is wanted:
    /// the state-changes kind is on and that change is picked.
    #[allow(dead_code)] // Called by the Web Push delivery.
    pub(crate) fn wants_state_change(&self, change: StateChange) -> bool {
        self.kinds.state_changes
            && match change {
                StateChange::Started => self.state_changes.started,
                StateChange::Pending => self.state_changes.pending,
                StateChange::Done => self.state_changes.done,
            }
    }
}

/// A card state change the delivery side may announce.
#[allow(dead_code)] // Used by the Web Push delivery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StateChange {
    Started,
    Pending,
    Done,
}

/// What a save may change. A group that is not sent keeps its saved value; a
/// group that is sent carries all of its fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Patch {
    pub kinds: Option<Kinds>,
    pub state_changes: Option<StateChanges>,
    pub periodic: Option<Periodic>,
}

/// The saved file, as written. Unknown keys make it invalid.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredFile {
    format_version: u32,
    revision: u64,
    kinds: Kinds,
    state_changes: StateChanges,
    periodic: Periodic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateError {
    /// The patch is empty or names an interval that is not offered.
    Invalid,
    /// The file could not be written. Nothing was changed.
    Unavailable,
}

/// Reads and atomically replaces the settings file. Clones share one lock, so
/// two saves never interleave their read and write.
#[derive(Debug, Clone)]
pub(crate) struct NotificationSettingsStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl NotificationSettingsStore {
    pub(crate) fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(INTERNAL_DIR).join(FILE_NAME),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// The saved settings, or the defaults when the file cannot be used. The
    /// delivery side calls this each time it decides what to send.
    pub(crate) fn load(&self) -> NotificationSettings {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read_saved().unwrap_or_default()
    }

    /// Applies the sent groups and saves the result as the next revision.
    pub(crate) fn update(&self, patch: Patch) -> Result<NotificationSettings, UpdateError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if patch.kinds.is_none() && patch.state_changes.is_none() && patch.periodic.is_none() {
            return Err(UpdateError::Invalid);
        }
        if let Some(periodic) = &patch.periodic
            && !PERIODIC_INTERVALS.contains(&periodic.interval_minutes)
        {
            return Err(UpdateError::Invalid);
        }
        let saved = self.read_saved();
        // A valid file continues its own count. A save that starts from the
        // defaults takes the current time in milliseconds when that is larger,
        // so the revision stays above any revision an open page showed.
        let revision = match &saved {
            Some(file) => file.revision + 1,
            None => 1u64.max(unix_millis()),
        };
        let current = saved.unwrap_or_default();
        let next = NotificationSettings {
            kinds: patch.kinds.unwrap_or(current.kinds),
            state_changes: patch.state_changes.unwrap_or(current.state_changes),
            periodic: patch.periodic.unwrap_or(current.periodic),
            revision,
        };
        self.write_file(&next)?;
        Ok(next)
    }

    fn read_saved(&self) -> Option<NotificationSettings> {
        let bytes = std::fs::read(&self.path).ok()?;
        let stored = serde_json::from_slice::<StoredFile>(&bytes).ok()?;
        let valid = stored.format_version == FORMAT_VERSION
            && PERIODIC_INTERVALS.contains(&stored.periodic.interval_minutes);
        if !valid {
            return None;
        }
        Some(NotificationSettings {
            kinds: stored.kinds,
            state_changes: stored.state_changes,
            periodic: stored.periodic,
            revision: stored.revision,
        })
    }

    /// Writes a temporary file beside the target and renames it over the
    /// target. Owner-only permissions where the platform supports them.
    fn write_file(&self, settings: &NotificationSettings) -> Result<(), UpdateError> {
        let stored = StoredFile {
            format_version: FORMAT_VERSION,
            revision: settings.revision,
            kinds: settings.kinds,
            state_changes: settings.state_changes,
            periodic: settings.periodic,
        };
        let bytes = serde_json::to_vec_pretty(&stored).map_err(|_| UpdateError::Unavailable)?;
        let dir = self.path.parent().ok_or(UpdateError::Unavailable)?;
        create_private_dir(dir).map_err(|_| UpdateError::Unavailable)?;
        remove_stale_temporaries(dir);
        let temporary = dir.join(format!("{FILE_NAME}.{}.tmp", std::process::id()));
        let result = write_owner_only(&temporary, &bytes)
            .and_then(|()| std::fs::rename(&temporary, &self.path));
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        } else {
            sync_dir(dir);
        }
        result.map_err(|_| UpdateError::Unavailable)
    }
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Removes temporary files that an earlier crashed save may have left.
fn remove_stale_temporaries(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let prefix = format!("{FILE_NAME}.");
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && name.ends_with(".tmp") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests;
