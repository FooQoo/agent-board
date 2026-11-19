//! The delivery ledger: what was sent to which device, kept in
//! `<data_dir>/.internal/push-ledger.json` (owner-only, replaced atomically).
//!
//! One entry per device and event key says what became of that event on that device: it was
//! `sent`, it failed and waits for another try (`pending`), it was not sent because the public
//! address was down (`skipped`), or it was given up (`dropped`). An event with an entry is never
//! sent to that device again, so a restart, or a second read of the same board data, shows
//! nothing twice. The ledger is bounded: old finished entries are forgotten, and an unreadable
//! file is an empty ledger. A save that fails is ignored; the board never waits for this file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use super::message::Payload;
use crate::server::monitor_connection::config::write_private_atomic;

const FILE_NAME: &str = "push-ledger.json";
const INTERNAL_DIR: &str = ".internal";
const FORMAT_VERSION: u32 = 1;
/// Finished entries are kept this long, and at most [`MAX_FINISHED`] of them.
const KEEP_DAYS: i64 = 14;
const MAX_FINISHED: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum State {
    Sent,
    Pending,
    Skipped,
    Dropped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Entry {
    pub device_id: String,
    pub key: String,
    pub state: State,
    /// How many times the push service was tried.
    pub attempts: u32,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
    /// When a `pending` entry is tried again.
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    pub retry_at: Option<DateTime<Utc>>,
    /// What to send again; only a `pending` entry has it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Payload>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct File {
    format_version: u32,
    entries: Vec<Entry>,
}

pub(super) struct Ledger {
    path: Option<PathBuf>,
    entries: Mutex<Vec<Entry>>,
}

impl Ledger {
    pub(super) fn open(data_dir: &Path) -> Self {
        let path = data_dir.join(INTERNAL_DIR).join(FILE_NAME);
        let entries = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<File>(&b).ok())
            .filter(|f| f.format_version == FORMAT_VERSION)
            .map(|f| f.entries)
            .unwrap_or_default();
        Self {
            path: Some(path),
            entries: Mutex::new(entries),
        }
    }

    #[cfg(test)]
    pub(super) fn in_memory() -> Self {
        Self {
            path: None,
            entries: Mutex::new(Vec::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Entry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, entries: &[Entry]) {
        let Some(path) = &self.path else {
            return;
        };
        let file = File {
            format_version: FORMAT_VERSION,
            entries: entries.to_vec(),
        };
        if let Ok(mut text) = serde_json::to_string_pretty(&file) {
            text.push('\n');
            let _ = write_private_atomic(path, text.as_bytes());
        }
    }

    /// Whether this event has an entry for this device, whatever became of it.
    pub(super) fn has(&self, device_id: &str, key: &str) -> bool {
        self.lock()
            .iter()
            .any(|e| e.device_id == device_id && e.key == key)
    }

    /// Set the entry of an event on a device, replacing an older one, and forget what is old.
    pub(super) fn record(&self, entry: Entry) {
        let mut entries = self.lock();
        entries.retain(|e| !(e.device_id == entry.device_id && e.key == entry.key));
        let now = entry.at;
        entries.push(entry);
        entries.retain(|e| e.state == State::Pending || now - e.at < Duration::days(KEEP_DAYS));
        let finished = entries.iter().filter(|e| e.state != State::Pending).count();
        if finished > MAX_FINISHED {
            let mut excess = finished - MAX_FINISHED;
            entries.retain(|e| {
                if excess > 0 && e.state != State::Pending {
                    excess -= 1;
                    false
                } else {
                    true
                }
            });
        }
        self.save(&entries);
    }

    /// The `pending` entries whose time has come.
    pub(super) fn due(&self, now: DateTime<Utc>) -> Vec<Entry> {
        self.lock()
            .iter()
            .filter(|e| e.state == State::Pending && e.retry_at.is_none_or(|t| t <= now))
            .cloned()
            .collect()
    }

    /// Forget everything about a device that is gone.
    pub(super) fn forget_device(&self, device_id: &str) {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|e| e.device_id != device_id);
        if entries.len() != before {
            self.save(&entries);
        }
    }

    #[cfg(test)]
    pub(super) fn entries(&self) -> Vec<Entry> {
        self.lock().clone()
    }
}

#[cfg(test)]
mod tests;
