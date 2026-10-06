use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Contents of `serve.json`: how the CLI finds a running `agboard serve`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServeInfo {
    pub pid: u32,
    pub port: u16,
    pub started_at: String,
}

/// The data directory: `$SKAN_HOME` if set (and not empty), otherwise `skan/`
/// under the OS application data directory.
pub fn data_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("SKAN_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(home);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("skan")
}

pub fn db_path() -> PathBuf {
    data_dir().join("board.db")
}

pub fn serve_info_path() -> PathBuf {
    data_dir().join("serve.json")
}

/// Read `serve.json`. A missing, unreadable or malformed file is `None`.
pub fn read_serve_info() -> Option<ServeInfo> {
    read_serve_info_in(&data_dir())
}

/// Read the `serve.json` inside `dir`: the data directory that holds the
/// database a command was actually run against.
pub fn read_serve_info_in(dir: &std::path::Path) -> Option<ServeInfo> {
    let text = std::fs::read_to_string(dir.join("serve.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write `serve.json`, creating the data directory if needed. Best effort:
/// failures are ignored because update notification is optional.
pub fn write_serve_info(info: &ServeInfo) {
    let path = serve_info_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string(info) {
        let _ = std::fs::write(path, text);
    }
}

/// Remove `serve.json` if it exists.
pub fn remove_serve_info() {
    let _ = std::fs::remove_file(serve_info_path());
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    // SKAN_HOME is process-global, so tests that change it must not overlap.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_home<T>(home: Option<&std::path::Path>, f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var_os("SKAN_HOME");
        // SAFETY: access to the environment is serialized by ENV_LOCK.
        unsafe {
            match home {
                Some(path) => std::env::set_var("SKAN_HOME", path),
                None => std::env::remove_var("SKAN_HOME"),
            }
        }
        let result = f();
        // SAFETY: as above.
        unsafe {
            match previous {
                Some(value) => std::env::set_var("SKAN_HOME", value),
                None => std::env::remove_var("SKAN_HOME"),
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
    fn data_dir_prefers_skan_home() {
        let tmp = tempfile::tempdir().unwrap();
        with_home(Some(tmp.path()), || {
            assert_eq!(data_dir(), tmp.path());
            assert_eq!(db_path(), tmp.path().join("board.db"));
            assert_eq!(serve_info_path(), tmp.path().join("serve.json"));
        });
    }

    #[test]
    fn data_dir_defaults_to_skan_under_the_os_data_dir() {
        with_home(None, || {
            assert_eq!(data_dir(), dirs::data_dir().unwrap().join("skan"));
        });
    }

    #[test]
    fn serve_info_round_trips_and_is_removed() {
        let tmp = tempfile::tempdir().unwrap();
        with_home(Some(tmp.path()), || {
            assert_eq!(read_serve_info(), None);
            write_serve_info(&sample());
            assert_eq!(read_serve_info(), Some(sample()));
            let text = std::fs::read_to_string(serve_info_path()).unwrap();
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
        let home = tmp.path().join("nested").join("skan");
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
                std::fs::write(serve_info_path(), text).unwrap();
                assert_eq!(read_serve_info(), None, "{text:?}");
            }
            // a directory where the file should be is also unreadable
            std::fs::remove_file(serve_info_path()).unwrap();
            std::fs::create_dir(serve_info_path()).unwrap();
            assert_eq!(read_serve_info(), None);
        });
    }
}
