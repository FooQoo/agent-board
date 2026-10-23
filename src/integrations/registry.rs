//! The installation registry: `<data-dir>/integrations.json`, which records
//! what connect installed so that update and the managed-content checks can
//! tell Agent Board's files from the user's. Only schemaVersion 1 is read;
//! an unknown or broken file is refused and never rewritten.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{Agent, Component, IntegrationError, Scope};

/// The only schemaVersion this build reads and writes.
pub const SCHEMA_VERSION: u64 = 1;

/// The whole registry file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Registry {
    pub installations: Vec<InstallationRecord>,
}

/// One installed component of one agent in one scope.
///
/// A Skill record lists its `files`; a Hook record lists its
/// `managed_entries`. The other list is empty. Project records carry the
/// project ID and the bound root; Global records carry neither.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallationRecord {
    pub agent: Agent,
    pub component: Component,
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bound_root: Option<PathBuf>,
    /// The location the effective configuration names, absolute.
    pub configured_path: PathBuf,
    /// The location after symbolic links are followed, absolute.
    pub resolved_path: PathBuf,
    /// The bundle version that was written, e.g. `0.1.0`.
    pub installed_version: String,
    /// Skill: the manifest hash of `files`. Hook: the hash of
    /// `managed_entries`. Both are lowercase hex SHA-256.
    pub managed_hash: String,
    #[serde(default)]
    pub managed_entries: Vec<ManagedHookEntry>,
    #[serde(default)]
    pub files: Vec<ManagedFile>,
}

/// One Skill file that Agent Board wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedFile {
    /// Path relative to the Skill directory, with `/` separators.
    pub path: String,
    /// Lowercase hex SHA-256 of the file's bytes.
    pub sha256: String,
}

/// One Hook group that Agent Board merged into a settings file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedHookEntry {
    pub event: String,
    /// The group's matcher, or `None` when the group has none.
    pub matcher: Option<String>,
    /// The fixed command of the group's single hook.
    pub command: String,
    /// Lowercase hex SHA-256 of the group's canonical JSON.
    pub sha256: String,
}

/// The file as written: the schema version and the installations.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistryFile {
    schema_version: u64,
    installations: Vec<InstallationRecord>,
}

impl Registry {
    /// An empty registry, as written before the first installation.
    pub fn new() -> Self {
        Self::default()
    }

    /// Parses and checks a registry file. Fails on any schemaVersion other
    /// than 1, on malformed JSON, and on records that break the rules in the
    /// module documentation. Nothing is migrated or repaired.
    pub fn parse(text: &str) -> Result<Self, IntegrationError> {
        let value: Value = serde_json::from_str(text)
            .map_err(|error| IntegrationError::Registry(format!("not JSON: {error}")))?;
        let version = value.get("schemaVersion").and_then(Value::as_u64);
        let version =
            version.ok_or_else(|| IntegrationError::Registry("schemaVersion is missing".into()))?;
        if version != SCHEMA_VERSION {
            return Err(IntegrationError::UnknownSchema(version));
        }
        let file: RegistryFile = serde_json::from_value(value)
            .map_err(|error| IntegrationError::Registry(error.to_string()))?;
        let registry = Registry {
            installations: file.installations,
        };
        registry.validate()?;
        Ok(registry)
    }

    /// The file text: pretty-printed JSON with a trailing newline.
    pub fn to_json(&self) -> String {
        let file = RegistryFile {
            schema_version: SCHEMA_VERSION,
            installations: self.installations.clone(),
        };
        // Serializing plain data into a JSON string cannot fail.
        let mut text = serde_json::to_string_pretty(&file).unwrap_or_default();
        text.push('\n');
        text
    }

    /// Reads the registry at `path`. `Ok(None)` when the file does not exist;
    /// an unreadable or invalid file is an error and is left as it is.
    pub fn read(path: &Path) -> Result<Option<Self>, IntegrationError> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::parse(&text).map(Some),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(IntegrationError::Registry(format!(
                "{} cannot be read: {error}",
                path.display()
            ))),
        }
    }

    /// Checks every record, and that no two records describe the same
    /// installation (agent, component, scope, and bound root).
    fn validate(&self) -> Result<(), IntegrationError> {
        let mut seen = BTreeSet::new();
        for record in &self.installations {
            record.validate().map_err(IntegrationError::Registry)?;
            let key = (
                record.agent,
                record.component,
                record.scope,
                record.bound_root.clone(),
            );
            if !seen.insert(key) {
                let reason = format!(
                    "{} {} is recorded twice",
                    record.agent.key(),
                    record.component.key()
                );
                return Err(IntegrationError::Registry(reason));
            }
        }
        Ok(())
    }
}

impl InstallationRecord {
    /// The rules a record must follow, as a reason when it does not.
    fn validate(&self) -> Result<(), String> {
        if !self.configured_path.is_absolute() || !self.resolved_path.is_absolute() {
            return Err("configuredPath and resolvedPath must be absolute".into());
        }
        match self.scope {
            Scope::Global if self.project_id.is_some() || self.bound_root.is_some() => {
                return Err("a global record carries no project".into());
            }
            Scope::Project => {
                let rooted = self
                    .bound_root
                    .as_ref()
                    .is_some_and(|root| root.is_absolute());
                if self.project_id.is_none() || !rooted {
                    return Err("a project record needs projectId and an absolute boundRoot".into());
                }
            }
            Scope::Global => {}
        }
        if !is_sha256(&self.managed_hash) {
            return Err("managedHash must be lowercase hex SHA-256".into());
        }
        match self.component {
            Component::Skill => {
                if !self.managed_entries.is_empty() || self.files.is_empty() {
                    return Err("a skill record lists files and no hook entries".into());
                }
                for file in &self.files {
                    if !is_relative_path(&file.path) || !is_sha256(&file.sha256) {
                        return Err(format!("invalid skill file record: {}", file.path));
                    }
                }
            }
            Component::Hook => {
                if !self.files.is_empty() || self.managed_entries.is_empty() {
                    return Err("a hook record lists hook entries and no files".into());
                }
                if self
                    .managed_entries
                    .iter()
                    .any(|entry| !is_sha256(&entry.sha256))
                {
                    return Err("a managed hook entry has an invalid sha256".into());
                }
            }
        }
        Ok(())
    }
}

/// Lowercase hex SHA-256: 64 characters from `0-9a-f`.
fn is_sha256(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A `/`-separated path inside the Skill directory: no absolute start and no
/// empty, `.`, or `..` segment.
fn is_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
