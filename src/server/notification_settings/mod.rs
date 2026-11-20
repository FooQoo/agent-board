//! Which notifications the phone receives, kept in the app's internal area as
//! `<data_dir>/.internal/notification-settings.json`. The file is the app's own
//! state, not a shared project file, so it is never in `shared/`.
//!
//! This module is the one definition of the kinds, the summary interval, and their defaults. The Web Push delivery side reads the saved value with
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

/// The kinds of notification. Each is switched on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "KindsWire")]
pub(crate) struct Kinds {
    /// A result (an intermediate draft or a final) was recorded on a task.
    pub results: bool,
    /// A question needs the user's decision.
    pub questions: bool,
    /// A history entry was added to a task.
    pub history: bool,
    /// A periodic summary of the results was recorded.
    pub summary: bool,
}

/// How [`Kinds`] is read. Older builds also saved a `stateChanges` kind for the removed card
/// state change notifications; it is accepted and dropped.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KindsWire {
    results: bool,
    questions: bool,
    history: bool,
    /// Absent from files and pages that predate the summary kind: it reads as on.
    #[serde(default)]
    summary: Option<bool>,
    #[serde(default)]
    #[allow(dead_code)]
    state_changes: Option<bool>,
}

impl From<KindsWire> for Kinds {
    fn from(wire: KindsWire) -> Self {
        Self {
            results: wire.results,
            questions: wire.questions,
            history: wire.history,
            summary: wire.summary.unwrap_or(true),
        }
    }
}

/// The intervals, in minutes, at which the server records a summary. `0` is off: nothing is
/// recorded.
pub(crate) const SUMMARY_INTERVALS: [u32; 5] = [0, 30, 60, 120, 240];
/// The interval of settings that do not say: every hour.
pub(crate) const DEFAULT_SUMMARY_INTERVAL: u32 = 60;

/// How often summaries are recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SummarySettings {
    /// One of [`SUMMARY_INTERVALS`]; `0` records no summary.
    pub interval_minutes: u32,
}

impl SummarySettings {
    fn valid(self) -> bool {
        SUMMARY_INTERVALS.contains(&self.interval_minutes)
    }
}

impl Default for SummarySettings {
    fn default() -> Self {
        Self {
            interval_minutes: DEFAULT_SUMMARY_INTERVAL,
        }
    }
}

/// The saved notification settings as the API carries them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationSettings {
    pub kinds: Kinds,
    pub summary: SummarySettings,
    pub revision: u64,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            kinds: Kinds {
                results: true,
                questions: false,
                history: false,
                summary: true,
            },
            summary: SummarySettings::default(),
            revision: 0,
        }
    }
}

/// What a save may change: the kinds, with all of their fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Patch {
    pub kinds: Option<Kinds>,
    pub summary: Option<SummarySettings>,
    /// The removed state-change and periodic groups. Older pages may still send them; they are
    /// accepted and ignored, so they never count as a change to save.
    #[serde(default)]
    #[allow(dead_code)]
    state_changes: Option<serde_json::Value>,
    #[serde(default)]
    #[allow(dead_code)]
    periodic: Option<serde_json::Value>,
}

/// The saved file, as written. Unknown keys make it invalid, except the removed `stateChanges`
/// and `periodic` groups that older builds wrote: they are read and dropped, and the next save
/// leaves them out.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredFile {
    format_version: u32,
    revision: u64,
    kinds: Kinds,
    /// Absent from files saved before summaries existed: it reads as the default and the file is
    /// left as it is until the next save.
    #[serde(default)]
    summary: Option<SummarySettings>,
    #[serde(default, skip_serializing)]
    #[allow(dead_code)]
    state_changes: Option<serde_json::Value>,
    #[serde(default, skip_serializing)]
    #[allow(dead_code)]
    periodic: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateError {
    /// The patch has nothing to save.
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
        if (patch.kinds.is_none() && patch.summary.is_none())
            || patch.summary.is_some_and(|s| !s.valid())
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
            summary: patch.summary.unwrap_or(current.summary),
            revision,
        };
        self.write_file(&next)?;
        Ok(next)
    }

    fn read_saved(&self) -> Option<NotificationSettings> {
        let bytes = std::fs::read(&self.path).ok()?;
        let stored = serde_json::from_slice::<StoredFile>(&bytes).ok()?;
        if stored.format_version != FORMAT_VERSION {
            return None;
        }
        Some(NotificationSettings {
            kinds: stored.kinds,
            summary: stored.summary.filter(|s| s.valid()).unwrap_or_default(),
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
            summary: Some(settings.summary),
            state_changes: None,
            periodic: None,
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
