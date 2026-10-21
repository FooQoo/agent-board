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
        let current = self.read_file();
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
            revision: current.revision + 1,
        };
        self.write_file(&next)?;
        Ok(next)
    }

    /// Reads the file. A missing, invalid, or unreadable file is the default.
    fn read_file(&self) -> Preferences {
        let Ok(bytes) = std::fs::read(&self.path) else {
            return Preferences::default();
        };
        let Ok(stored) = serde_json::from_slice::<StoredFile>(&bytes) else {
            return Preferences::default();
        };
        let valid = stored.format_version == FORMAT_VERSION
            && LOCALES.contains(&stored.locale.as_str())
            && valid_theme(&stored.theme);
        if !valid {
            return Preferences::default();
        }
        Preferences {
            locale: stored.locale,
            theme: stored.theme,
            revision: stored.revision,
        }
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
        std::fs::create_dir_all(dir).map_err(|_| UpdateError::Unavailable)?;
        let temporary = dir.join(format!("{FILE_NAME}.{}.tmp", std::process::id()));
        let result = write_owner_only(&temporary, &bytes)
            .and_then(|()| std::fs::rename(&temporary, &self.path));
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map_err(|_| UpdateError::Unavailable)
    }
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
mod tests {
    use super::*;

    fn store(dir: &Path) -> PreferencesStore {
        PreferencesStore::new(dir)
    }

    fn theme(mode: &str, accent: &str) -> Theme {
        Theme {
            mode: mode.to_string(),
            accent: accent.to_string(),
        }
    }

    #[test]
    fn a_missing_file_reads_as_the_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(store(tmp.path()).load(), Preferences::default());
    }

    #[test]
    fn a_saved_value_is_read_back_with_its_revision() {
        let tmp = tempfile::tempdir().unwrap();
        let s = store(tmp.path());
        let saved = s
            .update(Patch {
                locale: Some("ja".to_string()),
                theme: Some(theme("dark", "teal")),
            })
            .unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(s.load(), saved);
        assert!(
            tmp.path()
                .join(".internal")
                .join("preferences.json")
                .is_file()
        );
    }

    #[test]
    fn a_partial_save_keeps_the_other_field() {
        let tmp = tempfile::tempdir().unwrap();
        let s = store(tmp.path());
        s.update(Patch {
            locale: Some("ja".to_string()),
            theme: Some(theme("dark", "teal")),
        })
        .unwrap();
        let next = s
            .update(Patch {
                locale: None,
                theme: Some(theme("light", "red")),
            })
            .unwrap();
        assert_eq!(next.locale, "ja");
        assert_eq!(next.theme, theme("light", "red"));
        assert_eq!(next.revision, 2);
    }

    #[test]
    fn an_invalid_value_or_an_empty_patch_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let s = store(tmp.path());
        s.update(Patch {
            locale: Some("ja".to_string()),
            theme: None,
        })
        .unwrap();
        let before = s.load();
        for patch in [
            Patch {
                locale: Some("fr".to_string()),
                theme: None,
            },
            Patch {
                locale: None,
                theme: Some(theme("neon", "blue")),
            },
            Patch {
                locale: None,
                theme: Some(theme("light", "magenta")),
            },
            Patch {
                locale: None,
                theme: None,
            },
        ] {
            assert_eq!(s.update(patch), Err(UpdateError::Invalid));
        }
        assert_eq!(s.load(), before);
    }

    #[test]
    fn a_broken_file_reads_as_the_defaults_and_the_next_save_replaces_it() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(".internal");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("preferences.json"), b"{ not json").unwrap();
        let s = store(tmp.path());
        assert_eq!(s.load(), Preferences::default());
        let saved = s
            .update(Patch {
                locale: Some("ja".to_string()),
                theme: None,
            })
            .unwrap();
        assert_eq!(saved.theme, Preferences::default().theme);
        assert_eq!(s.load(), saved);
    }

    #[test]
    fn a_file_with_unknown_keys_or_another_version_is_not_used() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(".internal");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("preferences.json");
        std::fs::write(
            &path,
            br#"{"formatVersion":1,"revision":4,"locale":"ja","theme":{"mode":"dark","accent":"teal"},"extra":1}"#,
        )
        .unwrap();
        assert_eq!(store(tmp.path()).load(), Preferences::default());
        std::fs::write(
            &path,
            br#"{"formatVersion":2,"revision":4,"locale":"ja","theme":{"mode":"dark","accent":"teal"}}"#,
        )
        .unwrap();
        assert_eq!(store(tmp.path()).load(), Preferences::default());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_owner_only_and_no_temporary_file_remains() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        store(tmp.path())
            .update(Patch {
                locale: Some("ja".to_string()),
                theme: None,
            })
            .unwrap();
        let path = tmp.path().join(".internal").join("preferences.json");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_save_that_cannot_be_written_reports_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        // A regular file where the internal folder should be makes the write fail.
        std::fs::write(tmp.path().join(".internal"), b"x").unwrap();
        let result = store(tmp.path()).update(Patch {
            locale: Some("ja".to_string()),
            theme: None,
        });
        assert_eq!(result, Err(UpdateError::Unavailable));
        assert_eq!(store(tmp.path()).load(), Preferences::default());
    }
}
