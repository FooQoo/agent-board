//! Environment and path resolution for `agboard setup`. The paths are resolved
//! once per run and used as absolute paths from then on.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::AgboardError;
use crate::paths;

/// The process environment that decides every path setup touches. Built once
/// by [`SetupEnv::from_process`]; tests build it by hand.
#[derive(Debug, Clone, Default)]
pub struct SetupEnv {
    pub agboard_home: Option<OsString>,
    pub home: Option<PathBuf>,
    pub codex_home: Option<OsString>,
    pub claude_config_dir: Option<OsString>,
}

impl SetupEnv {
    pub fn from_process() -> Self {
        SetupEnv {
            agboard_home: std::env::var_os("AGBOARD_HOME"),
            home: dirs::home_dir(),
            codex_home: std::env::var_os("CODEX_HOME"),
            claude_config_dir: std::env::var_os("CLAUDE_CONFIG_DIR"),
        }
    }

    /// The data directory, as an absolute path. Uses the same rule as the CLI,
    /// server, and hooks (`paths::data_dir_from`).
    pub fn data_dir(&self) -> Result<PathBuf, AgboardError> {
        let dir = paths::data_dir_from(self.agboard_home.clone(), self.home.clone())?;
        absolute(dir)
    }

    /// Codex's user config: `$CODEX_HOME/config.toml`, or `~/.codex/config.toml`.
    /// An empty `CODEX_HOME` counts as unset.
    pub fn codex_config(&self) -> Result<PathBuf, AgboardError> {
        let dir = match non_empty(&self.codex_home) {
            Some(dir) => PathBuf::from(dir),
            None => self.home_dir("CODEX_HOME")?.join(".codex"),
        };
        absolute(dir.join("config.toml"))
    }

    /// Claude Code's user settings: `$CLAUDE_CONFIG_DIR/settings.json`, or
    /// `~/.claude/settings.json`. An empty `CLAUDE_CONFIG_DIR` counts as unset.
    pub fn claude_settings(&self) -> Result<PathBuf, AgboardError> {
        let dir = match non_empty(&self.claude_config_dir) {
            Some(dir) => PathBuf::from(dir),
            None => self.home_dir("CLAUDE_CONFIG_DIR")?.join(".claude"),
        };
        absolute(dir.join("settings.json"))
    }

    fn home_dir(&self, override_name: &str) -> Result<PathBuf, AgboardError> {
        match self
            .home
            .as_deref()
            .filter(|dir| !dir.as_os_str().is_empty())
        {
            Some(home) => Ok(home.to_path_buf()),
            None => Err(AgboardError::BoardUnavailable {
                reason: format!(
                    "The home directory cannot be found. Set {override_name} to the agent's configuration directory."
                ),
            }),
        }
    }
}

fn non_empty(value: &Option<OsString>) -> Option<&OsString> {
    value.as_ref().filter(|value| !value.is_empty())
}

/// Makes `path` absolute against the working directory without touching the
/// file system (no symbolic link is resolved here).
pub fn absolute(path: PathBuf) -> Result<PathBuf, AgboardError> {
    std::path::absolute(&path).map_err(|error| AgboardError::BoardUnavailable {
        reason: format!("{} cannot be made absolute: {error}.", path.display()),
    })
}

/// Display form of a path for messages and JSON.
pub fn display(path: &Path) -> String {
    path.display().to_string()
}
