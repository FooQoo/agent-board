//! The sessions to launch when the server starts, kept as
//! `<data_dir>/.internal/resident-autostart.json`. The file is the app's own state: it is written
//! only through the API, atomically and with owner-only permissions. A missing, invalid, or
//! unreadable file reads as "nothing to start".

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::server::preferences::{create_private_dir, sync_dir, write_owner_only};
use crate::server::sessions::Tool;

const FORMAT_VERSION: u32 = 1;
const FILE_NAME: &str = "resident-autostart.json";

/// What to start for one tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutoStart {
    pub project_id: ProjectId,
    /// `None` leaves the model to the tool.
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredFile {
    format_version: u32,
    /// Keyed by the tool name (`claude-code`, `codex`).
    tools: BTreeMap<String, AutoStart>,
}

/// Reads and atomically replaces the auto-start file. Clones share one lock.
#[derive(Debug, Clone)]
pub struct AutoStartStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl AutoStartStore {
    pub fn new(data_dir: &Path) -> AutoStartStore {
        AutoStartStore {
            path: data_dir.join(".internal").join(FILE_NAME),
            lock: Arc::new(Mutex::new(())),
        }
    }

    fn read(&self) -> BTreeMap<String, AutoStart> {
        let loaded = std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredFile>(&bytes).ok())
            .filter(|file| file.format_version == FORMAT_VERSION);
        loaded.map(|file| file.tools).unwrap_or_default()
    }

    /// The saved choice for `tool`, if any.
    pub fn get(&self, tool: Tool) -> Option<AutoStart> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read().remove(tool.as_str())
    }

    /// Every saved choice, ordered by tool name.
    pub fn all(&self) -> Vec<(Tool, AutoStart)> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read()
            .into_iter()
            .map(|(name, entry)| (Tool::parse(&name), entry))
            .filter(|(tool, _)| *tool != Tool::Unknown)
            .collect()
    }

    /// Save (`Some`) or remove (`None`) the choice for `tool`.
    pub fn set(&self, tool: Tool, choice: Option<AutoStart>) -> Result<(), AgboardError> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut tools = self.read();
        match choice {
            Some(choice) => tools.insert(tool.as_str().to_string(), choice),
            None => tools.remove(tool.as_str()),
        };
        self.write(&StoredFile {
            format_version: FORMAT_VERSION,
            tools,
        })
        .map_err(|e| AgboardError::SessionLaunchFailed {
            reason: format!("Cannot save {}: {e}.", self.path.display()),
        })
    }

    fn write(&self, file: &StoredFile) -> std::io::Result<()> {
        let mut bytes = serde_json::to_vec_pretty(file).map_err(std::io::Error::other)?;
        bytes.push(b'\n');
        let dir = self.path.parent().unwrap_or(Path::new("."));
        create_private_dir(dir).or_else(|e| if dir.is_dir() { Ok(()) } else { Err(e) })?;
        let temporary = dir.join(format!("{FILE_NAME}.{}.tmp", std::process::id()));
        let result = write_owner_only(&temporary, &bytes)
            .and_then(|()| std::fs::rename(&temporary, &self.path));
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        } else {
            sync_dir(dir);
        }
        result
    }
}
