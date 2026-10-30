//! The display preferences (language and color theme), kept in the app's
//! internal area as `<data_dir>/.internal/preferences.json`. The file is the
//! app's own state, not a shared project file, so it is never in `shared/`.
//!
//! A missing, invalid, or unreadable file reads as the defaults. A save
//! replaces the whole file in one step, and a failed save leaves the old file
//! as it was.

pub(crate) mod http;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// The only file format this build reads and writes.
const FORMAT_VERSION: u32 = 1;
const INTERNAL_DIR: &str = ".internal";
const FILE_NAME: &str = "preferences.json";

pub(crate) const LOCALES: [&str; 2] = ["en", "ja"];
pub(crate) const MODES: [&str; 2] = ["light", "dark"];
pub(crate) const ACCENTS: [&str; 12] = [
    "blue", "sky", "cyan", "teal", "green", "lime", "yellow", "orange", "red", "pink", "purple",
    "gray",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Theme {
    pub mode: String,
    pub accent: String,
}

/// The saved preferences as the API and the change notice carry them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preferences {
    pub locale: String,
    pub theme: Theme,
    pub revision: u64,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            locale: "en".to_string(),
            theme: Theme {
                mode: "light".to_string(),
                accent: "blue".to_string(),
            },
            revision: 0,
        }
    }
}

/// What a save may change. A field that is not sent keeps its saved value.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Patch {
    pub locale: Option<String>,
    pub theme: Option<Theme>,
}

/// The saved file, as written. Unknown keys make it invalid.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredFile {
    format_version: u32,
    revision: u64,
    locale: String,
    theme: Theme,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateError {
    /// The patch names a field that is not allowed, or a value that is not valid.
    Invalid,
    /// The file could not be written. Nothing was changed.
    Unavailable,
}

/// Reads and atomically replaces the preferences file. Clones share one lock,
/// so two saves never interleave their read and write.
#[derive(Debug, Clone)]
pub(crate) struct PreferencesStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl PreferencesStore {
    pub(crate) fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(INTERNAL_DIR).join(FILE_NAME),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// The saved preferences, or the defaults when the file cannot be used.
    pub(crate) fn load(&self) -> Preferences {
        let guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let loaded = self.read_file();
        drop(guard);
        loaded
    }

    /// Applies the sent fields and saves the result as the next revision.
    pub(crate) fn update(&self, patch: Patch) -> Result<Preferences, UpdateError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if patch.locale.is_none() && patch.theme.is_none() {
            return Err(UpdateError::Invalid);
        }
        let saved = self.read_saved();
        // A valid file continues its own count. A save that starts from the
        // defaults (missing or invalid file) takes the current time in
        // milliseconds when that is larger, so the revision stays above any
        // revision an open page may already have shown.
        let revision = match &saved {
            Some(file) => file.revision + 1,
            None => (Preferences::default().revision + 1).max(unix_millis()),
        };
        let current = saved.unwrap_or_default();
        let next = Preferences {
            locale: match patch.locale {
                Some(locale) if LOCALES.contains(&locale.as_str()) => locale,
                Some(_) => return Err(UpdateError::Invalid),
                None => current.locale,
            },
            theme: match patch.theme {
                Some(theme) if valid_theme(&theme) => theme,
                Some(_) => return Err(UpdateError::Invalid),
                None => current.theme,
            },
            revision,
        };
        self.write_file(&next)?;
        Ok(next)
    }

    /// Reads the file. A missing, invalid, or unreadable file is the default.
    fn read_file(&self) -> Preferences {
        self.read_saved().unwrap_or_default()
    }

    /// The saved preferences, or `None` when the file cannot be used.
    fn read_saved(&self) -> Option<Preferences> {
        let bytes = std::fs::read(&self.path).ok()?;
        let stored = serde_json::from_slice::<StoredFile>(&bytes).ok()?;
        let valid = stored.format_version == FORMAT_VERSION
            && LOCALES.contains(&stored.locale.as_str())
            && valid_theme(&stored.theme);
        if !valid {
            return None;
        }
        Some(Preferences {
            locale: stored.locale,
            theme: stored.theme,
            revision: stored.revision,
        })
    }

    /// Writes a temporary file beside the target and renames it over the
    /// target. Owner-only permissions where the platform supports them.
    fn write_file(&self, prefs: &Preferences) -> Result<(), UpdateError> {
        let stored = StoredFile {
            format_version: FORMAT_VERSION,
            revision: prefs.revision,
            locale: prefs.locale.clone(),
            theme: prefs.theme.clone(),
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

/// Creates the folder (and missing parents) with owner-only access on unix.
/// An existing folder keeps its mode.
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
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

/// Makes the rename durable. Errors are ignored; the file itself is synced.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn valid_theme(theme: &Theme) -> bool {
    MODES.contains(&theme.mode.as_str()) && ACCENTS.contains(&theme.accent.as_str())
}

fn write_owner_only(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests;
