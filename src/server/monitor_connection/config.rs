//! The saved, non-secret settings, kept in the app's internal area:
//! `<data_dir>/.internal/monitor-connection.json`.
//!
//! The file is the app's own state, not something a person edits. It holds
//! only what the contract allows on disk. Tokens, passcodes and sessions are
//! never written here.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::contracts::ConnectionConfig;

/// The only file format this build reads and writes.
pub const FORMAT_VERSION: u32 = 1;

/// The data area's internal folder, next to the project `.internal/` folders in name.
const INTERNAL_DIR: &str = ".internal";
const FILE_NAME: &str = "monitor-connection.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredFile {
    format_version: u32,
    revision: u64,
    enabled: bool,
    /// Absent in files written before the domain was a setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    domain: Option<String>,
}

/// Why the saved settings could not be read or written. Never carries file contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// The file exists but is not a valid version 1 settings file.
    Invalid,
    /// The file could not be read or written.
    Io(String),
}

/// An exclusive lock, across processes, on the settings file. Whoever reads the settings in order
/// to change them (this server, `agboard setup remote`) holds it from the read to the save, so
/// two writers never both build on the same revision. Released when dropped.
pub struct ConfigLock(#[allow(dead_code)] Option<std::fs::File>);

/// Reads and atomically replaces the settings file.
#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    /// The data area this store is in (the parent of its internal folder).
    pub fn data_dir(&self) -> &Path {
        self.path
            .parent()
            .and_then(Path::parent)
            .unwrap_or(Path::new("."))
    }

    /// Take the exclusive lock, waiting for the holder (who keeps it only for a read and a
    /// save). When the lock cannot be taken the caller must not write.
    pub fn lock(&self) -> Result<ConfigLock, ConfigError> {
        let io = |e: std::io::Error| ConfigError::Io(e.kind().to_string());
        let dir = self
            .path
            .parent()
            .ok_or_else(|| ConfigError::Io("no parent folder".to_string()))?;
        create_private_dir(dir).map_err(io)?;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join("monitor-connection.lock"))
            .map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            loop {
                // SAFETY: flock on a descriptor this function owns.
                if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                    break;
                }
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::Interrupted {
                    return Err(io(error));
                }
            }
        }
        Ok(ConfigLock(Some(file)))
    }

    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(INTERNAL_DIR).join(FILE_NAME),
        }
    }

    /// The saved settings, or the disabled defaults when there is no file.
    pub fn load(&self) -> Result<ConnectionConfig, ConfigError> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ConnectionConfig::default());
            }
            Err(e) => return Err(ConfigError::Io(e.kind().to_string())),
        };
        let stored: StoredFile =
            serde_json::from_slice(&bytes).map_err(|_| ConfigError::Invalid)?;
        if stored.format_version != FORMAT_VERSION {
            return Err(ConfigError::Invalid);
        }
        Ok(ConnectionConfig {
            enabled: stored.enabled,
            revision: stored.revision,
            // A saved value that is not a plain host name is not used.
            domain: stored
                .domain
                .as_deref()
                .and_then(super::types::parse_domain),
        })
    }

    /// Replace the file in one step with owner-only permissions. On failure the
    /// previous file is left as it was.
    pub fn save(&self, config: &ConnectionConfig) -> Result<(), ConfigError> {
        let stored = StoredFile {
            format_version: FORMAT_VERSION,
            revision: config.revision,
            enabled: config.enabled,
            domain: config.domain.clone(),
        };
        let mut text =
            serde_json::to_string_pretty(&stored).map_err(|e| ConfigError::Io(e.to_string()))?;
        text.push('\n');
        write_private_atomic(&self.path, text.as_bytes())
            .map_err(|e| ConfigError::Io(e.kind().to_string()))
    }
}

pub(crate) fn write_private_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("no parent folder"))?;
    create_private_dir(dir)?;
    let mut nonce = [0u8; 8];
    getrandom::fill(&mut nonce).map_err(|e| std::io::Error::other(e.to_string()))?;
    let suffix: String = nonce.iter().map(|b| format!("{b:02x}")).collect();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(FILE_NAME);
    let temp = dir.join(format!(".{name}.tmp-{suffix}"));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)?;
        std::fs::File::open(dir)?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    if dir.is_dir() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ConnectionConfig {
        ConnectionConfig {
            enabled: true,
            revision: 3,
            domain: Some("example.ngrok-free.dev".to_string()),
        }
    }

    #[test]
    fn missing_file_is_the_disabled_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            ConfigStore::new(dir.path()).load().unwrap(),
            ConnectionConfig::default()
        );
    }

    #[test]
    fn saves_and_loads_with_owner_only_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(dir.path());
        store.save(&sample()).unwrap();
        assert_eq!(store.load().unwrap(), sample());
        let text =
            std::fs::read_to_string(dir.path().join(".internal/monitor-connection.json")).unwrap();
        assert!(text.contains("\"formatVersion\": 1"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(".internal/monitor-connection.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn unknown_fields_and_versions_are_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(dir.path());
        store.save(&sample()).unwrap();
        let path = dir.path().join(".internal/monitor-connection.json");
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(
            &path,
            text.replace("\"formatVersion\": 1", "\"formatVersion\": 2"),
        )
        .unwrap();
        assert_eq!(store.load(), Err(ConfigError::Invalid));
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(store.load(), Err(ConfigError::Invalid));
        // A file with fields this build does not know (the Google sign-in) is not read.
        let stale = r#"{"formatVersion":1,"revision":1,"enabled":true,"allowEmails":["a@x.com"],"oauthApp":"managed"}"#;
        std::fs::write(&path, stale).unwrap();
        assert_eq!(store.load(), Err(ConfigError::Invalid));
    }

    #[test]
    fn the_saved_file_holds_only_the_non_secret_settings() {
        let dir = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(dir.path());
        store.save(&sample()).unwrap();
        let text =
            std::fs::read_to_string(dir.path().join(".internal/monitor-connection.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort();
        assert_eq!(keys, ["domain", "enabled", "formatVersion", "revision"]);
    }

    #[test]
    fn a_file_without_a_domain_loads_and_a_bad_domain_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let store = ConfigStore::new(dir.path());
        let path = dir.path().join(".internal/monitor-connection.json");
        store
            .save(&ConnectionConfig {
                enabled: true,
                revision: 1,
                domain: None,
            })
            .unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("domain"));
        assert_eq!(store.load().unwrap().domain, None);
        std::fs::write(
            &path,
            r#"{"formatVersion":1,"revision":1,"enabled":true,"domain":"https://a.ngrok.app/x"}"#,
        )
        .unwrap();
        assert_eq!(store.load().unwrap().domain, None);
    }
}
