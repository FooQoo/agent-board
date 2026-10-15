use std::ffi::OsString;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AgboardError;

/// Name of the data directory directly under the home directory.
pub const DEFAULT_DATA_DIR_NAME: &str = ".agent-board";

/// Contents of `serve.json`: how the CLI finds a running `agboard serve`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServeInfo {
    pub pid: u32,
    pub port: u16,
    pub started_at: String,
}

/// The data directory: `$AGBOARD_HOME` when it is set and not empty, otherwise
/// `.agent-board` directly under the home directory. When neither can be found
/// this is an error; the working directory is never used instead.
pub fn data_dir() -> Result<PathBuf, AgboardError> {
    data_dir_from(std::env::var_os("AGBOARD_HOME"), dirs::home_dir())
}

/// [`data_dir`] with its inputs given, so the rule needs no process environment.
/// An empty `AGBOARD_HOME` counts as unset.
pub fn data_dir_from(
    agboard_home: Option<OsString>,
    home: Option<PathBuf>,
) -> Result<PathBuf, AgboardError> {
    if let Some(dir) = agboard_home.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    match home.filter(|dir| !dir.as_os_str().is_empty()) {
        Some(home) => Ok(home.join(DEFAULT_DATA_DIR_NAME)),
        None => Err(AgboardError::BoardUnavailable {
            reason: "The home directory cannot be found. Set AGBOARD_HOME to the data directory."
                .to_string(),
        }),
    }
}

/// The shared file area: every project's canonical files live below it.
pub fn shared_dir() -> Result<PathBuf, AgboardError> {
    Ok(data_dir()?.join("shared"))
}

pub fn serve_info_path() -> Result<PathBuf, AgboardError> {
    Ok(data_dir()?.join("serve.json"))
}

/// Read `serve.json`. A missing, unreadable or malformed file is `None`.
pub fn read_serve_info() -> Option<ServeInfo> {
    read_serve_info_in(&data_dir().ok()?)
}

/// Read the `serve.json` inside `dir`: the data directory a command was
/// actually run against.
pub fn read_serve_info_in(dir: &std::path::Path) -> Option<ServeInfo> {
    let text = std::fs::read_to_string(dir.join("serve.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write `serve.json`, creating the data directory if needed. Best effort:
/// failures are ignored because update notification is optional.
pub fn write_serve_info(info: &ServeInfo) {
    if let Ok(dir) = data_dir() {
        write_serve_info_in(&dir, info);
    }
}

/// Write the registration to the data directory captured by the caller.
pub fn write_serve_info_in(dir: &std::path::Path, info: &ServeInfo) {
    let path = dir.join("serve.json");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(info) {
        let _ = std::fs::write(path, text);
    }
}

/// Remove `serve.json` if it exists.
pub fn remove_serve_info() {
    if let Ok(path) = serve_info_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    // AGBOARD_HOME is process-global, so tests that change it must not overlap.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_home<T>(home: Option<&std::path::Path>, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var_os("AGBOARD_HOME");
        // SAFETY: access to the environment is serialized by ENV_LOCK.
        unsafe {
            match home {
                Some(path) => std::env::set_var("AGBOARD_HOME", path),
                None => std::env::remove_var("AGBOARD_HOME"),
            }
        }
        let result = f();
        // SAFETY: as above.
        unsafe {
            match previous {
                Some(value) => std::env::set_var("AGBOARD_HOME", value),
                None => std::env::remove_var("AGBOARD_HOME"),
            }
        }
        result
    }

    fn sample() -> ServeInfo {
        ServeInfo {
            pid: 41235,
            port: 7420,
            started_at: "2026-10-02T01:00:00Z".into(),
        }
    }

    #[test]
    fn agboard_home_takes_precedence_over_the_home_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let resolved = data_dir_from(Some(tmp.path().into()), Some(PathBuf::from("/srv/someone")));
        assert_eq!(resolved.unwrap(), tmp.path());
    }

    #[test]
    fn default_data_dir_is_directly_under_the_home_directory() {
        let resolved = data_dir_from(None, Some(PathBuf::from("/srv/someone")));
        assert_eq!(
            resolved.unwrap(),
            PathBuf::from("/srv/someone").join(".agent-board")
        );
    }

    #[test]
    fn an_empty_agboard_home_counts_as_unset() {
        let resolved = data_dir_from(Some(OsString::new()), Some(PathBuf::from("/srv/someone")));
        assert_eq!(
            resolved.unwrap(),
            PathBuf::from("/srv/someone").join(".agent-board")
        );
    }

    #[test]
    fn a_missing_home_directory_is_an_error_not_the_working_directory() {
        let error = data_dir_from(None, None).unwrap_err();
        assert_eq!(error.code(), "board_unavailable");
        let empty_home = data_dir_from(None, Some(PathBuf::new())).unwrap_err();
        assert_eq!(empty_home.code(), "board_unavailable");
        // An explicit AGBOARD_HOME still works without a home directory.
        assert!(data_dir_from(Some("/data".into()), None).is_ok());
    }

    #[test]
    fn data_dir_prefers_agboard_home() {
        let tmp = tempfile::tempdir().unwrap();
        with_home(Some(tmp.path()), || {
            assert_eq!(data_dir().unwrap(), tmp.path());
            assert_eq!(shared_dir().unwrap(), tmp.path().join("shared"));
            assert_eq!(serve_info_path().unwrap(), tmp.path().join("serve.json"));
        });
    }

    #[test]
    fn data_dir_defaults_to_agent_board_in_the_home_directory() {
        with_home(None, || {
            assert_eq!(
                data_dir().unwrap(),
                dirs::home_dir().unwrap().join(".agent-board")
            );
        });
    }

    #[test]
    fn serve_info_round_trips_and_is_removed() {
        let tmp = tempfile::tempdir().unwrap();
        with_home(Some(tmp.path()), || {
            assert_eq!(read_serve_info(), None);
            write_serve_info(&sample());
            assert_eq!(read_serve_info(), Some(sample()));
            let text = std::fs::read_to_string(serve_info_path().unwrap()).unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&text).unwrap(),
                serde_json::json!({"pid": 41235, "port": 7420, "started_at": "2026-10-02T01:00:00Z"})
            );
            remove_serve_info();
            assert_eq!(read_serve_info(), None);
            // removing again is harmless
            remove_serve_info();
        });
    }

    #[test]
    fn write_serve_info_creates_the_data_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("nested").join("agent-board");
        with_home(Some(&home), || {
            write_serve_info(&sample());
            assert_eq!(read_serve_info(), Some(sample()));
        });
    }

    #[test]
    fn broken_serve_info_reads_as_none() {
        let tmp = tempfile::tempdir().unwrap();
        with_home(Some(tmp.path()), || {
            for text in [
                "",
                "not json",
                "{}",
                r#"{"pid":1,"port":99999,"started_at":"x"}"#,
                "[1,2]",
            ] {
                std::fs::write(serve_info_path().unwrap(), text).unwrap();
                assert_eq!(read_serve_info(), None, "{text:?}");
            }
            // a directory where the file should be is also unreadable
            std::fs::remove_file(serve_info_path().unwrap()).unwrap();
            std::fs::create_dir(serve_info_path().unwrap()).unwrap();
            assert_eq!(read_serve_info(), None);
        });
    }
}
