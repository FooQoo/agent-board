//! The transaction journal and the per-agent lock. The journal is a small
//! JSON file in the data directory, written before the first change of an
//! agent's transaction and removed when the transaction ends. It records, for
//! every file or directory the transaction touches, the hash it had before,
//! the hash it will have, and where its backup is. That is all a later run
//! needs to tell a finished, a half-done, and an untouched change apart.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::assets::{sha256_hex, skill_manifest_hash};
use super::plan::OpKind;
use super::skill::list_files;
use super::types::Agent;
use crate::setup::apply::{NEW_FILE_MODE, write_atomically};

/// One touched file or directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalOp {
    pub kind: OpKind,
    pub path: PathBuf,
    /// The state before: a file's SHA-256, a directory's manifest hash, or
    /// `None` when it did not exist.
    pub original_hash: Option<String>,
    /// The state after the change; `None` when the change removes it.
    pub planned_hash: Option<String>,
    /// The copy of a file, or the renamed original directory.
    pub backup: Option<PathBuf>,
    /// The directory a new Skill tree is built in before it is renamed into place.
    pub stage: Option<PathBuf>,
}

/// The journal of one agent's transaction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub version: u64,
    pub agent: Agent,
    pub txn: String,
    pub ops: Vec<JournalOp>,
}

pub fn journal_path(data_dir: &Path, agent: Agent) -> PathBuf {
    data_dir.join(format!("integrations-journal-{}.json", agent.key()))
}

/// Writes the journal atomically; owner-only, because it names settings files.
pub fn write_journal(data_dir: &Path, journal: &Journal) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let mut text = serde_json::to_string_pretty(journal).map_err(|error| error.to_string())?;
    text.push('\n');
    write_atomically(
        &journal_path(data_dir, journal.agent),
        text.as_bytes(),
        NEW_FILE_MODE,
    )
    .map_err(|error| error.to_string())
}

/// The pending journal of `agent`, or `None`.
pub fn read_journal(data_dir: &Path, agent: Agent) -> Result<Option<Journal>, String> {
    let path = journal_path(data_dir, agent);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| format!("{} is unreadable: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{} cannot be read: {error}", path.display())),
    }
}

pub fn remove_journal(data_dir: &Path, agent: Agent) {
    let _ = fs::remove_file(journal_path(data_dir, agent));
}

/// The state of `path` as the journal hashes it: a file's SHA-256, a
/// directory's manifest hash, `None` when absent. A directory that cannot be
/// read as plain files has a hash that matches nothing.
pub fn state_hash(kind: OpKind, path: &Path) -> Result<Option<String>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{} cannot be read: {error}", path.display())),
    };
    match kind {
        OpKind::File if meta.is_file() => fs::read(path)
            .map(|bytes| Some(sha256_hex(&bytes)))
            .map_err(|error| format!("{} cannot be read: {error}", path.display())),
        OpKind::Tree if meta.is_dir() => Ok(Some(match list_files(path) {
            Ok(files) => skill_manifest_hash(&files),
            Err(_) => "unreadable".to_owned(),
        })),
        _ => Ok(Some("unexpected-type".to_owned())),
    }
}

/// An exclusive lock on one agent's installation, held until dropped. A
/// second run for the same agent fails at once instead of waiting.
#[derive(Debug)]
pub struct AgentLock {
    _file: File,
}

impl AgentLock {
    pub fn acquire(data_dir: &Path, agent: Agent) -> Result<Self, String> {
        fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
        let path = data_dir.join(format!("integrations-{}.lock", agent.key()));
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(|error| format!("{} cannot be opened: {error}", path.display()))?;
        file.try_lock().map_err(|_| {
            format!(
                "another run is changing the {} integration; try again when it ends.",
                agent.label()
            )
        })?;
        Ok(AgentLock { _file: file })
    }
}
