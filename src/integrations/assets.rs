//! The Skill and Hook files embedded in the binary, and the hashes that
//! identify them. `build.rs` writes the table of the allowlisted sources into
//! `OUT_DIR`; nothing is read from the development tree at run time.
//!
//! Bundle paths (`relative_path`) are relative to the bundle root:
//! - `skill/SKILL.md`, `skill/references/<name>.md`, `skill/assets/<name>.md`:
//!   the Skill directory. [`EmbeddedBundle::skill_managed_files`] strips the
//!   `skill/` prefix to give the path inside the Skill directory.
//! - `hooks/claude.json` and `hooks/codex.json`: the Hook templates.

use std::fmt::Write as _;

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::registry::{ManagedFile, ManagedHookEntry};
use super::types::{Agent, IntegrationError};

include!(concat!(env!("OUT_DIR"), "/integration_bundle.rs"));

/// One embedded file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedEntry {
    /// Path relative to the bundle root, with `/` separators.
    pub relative_path: &'static str,
    /// The file's exact bytes, from the repository source at build time.
    pub bytes: &'static [u8],
    /// Lowercase hex SHA-256 of `bytes`.
    pub sha256: String,
}

/// Every embedded file, with the package version that embedded them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedBundle {
    /// The package version, e.g. `0.1.0`. Recorded as `installedVersion`.
    pub version: &'static str,
    /// Sorted by `relative_path`.
    pub entries: Vec<EmbeddedEntry>,
}

/// The bundle of this build. Fails only when the embedded table is empty,
/// which the build script never produces.
pub fn bundle() -> Result<EmbeddedBundle, IntegrationError> {
    let entries: Vec<EmbeddedEntry> = INTEGRATION_FILES
        .iter()
        .map(|&(relative_path, bytes)| EmbeddedEntry {
            relative_path,
            bytes,
            sha256: sha256_hex(bytes),
        })
        .collect();
    if entries.is_empty() {
        return Err(IntegrationError::Bundle("no files are embedded".into()));
    }
    Ok(EmbeddedBundle {
        version: env!("CARGO_PKG_VERSION"),
        entries,
    })
}

impl EmbeddedBundle {
    /// The entry at `relative_path`, if the bundle has one.
    pub fn entry(&self, relative_path: &str) -> Option<&EmbeddedEntry> {
        self.entries
            .iter()
            .find(|entry| entry.relative_path == relative_path)
    }

    /// The Skill entries, with their bundle paths (`skill/...`), sorted.
    pub fn skill_files(&self) -> Vec<&EmbeddedEntry> {
        self.entries
            .iter()
            .filter(|entry| entry.relative_path.starts_with("skill/"))
            .collect()
    }

    /// The Skill files as the registry records them: the path inside the
    /// Skill directory (`SKILL.md`, `references/...`) and the SHA-256, sorted
    /// by path.
    pub fn skill_managed_files(&self) -> Vec<ManagedFile> {
        let mut files: Vec<ManagedFile> = self
            .skill_files()
            .into_iter()
            .map(|entry| ManagedFile {
                path: entry.relative_path["skill/".len()..].to_owned(),
                sha256: entry.sha256.clone(),
            })
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        files
    }
}

/// The managed Hook groups of `agent`'s template, sorted by event, then
/// matcher (no matcher first), then command. A group's hash is the SHA-256 of
/// its canonical JSON. Each group must hold exactly one hook with a command.
pub fn hook_managed_entries(
    bundle: &EmbeddedBundle,
    agent: Agent,
) -> Result<Vec<ManagedHookEntry>, IntegrationError> {
    let bad =
        |reason: &str| IntegrationError::Bundle(format!("{} hook template: {reason}", agent.key()));
    let template = bundle
        .entry(&format!("hooks/{}.json", agent.key()))
        .ok_or_else(|| bad("missing"))?;
    let json: Value = serde_json::from_slice(template.bytes).map_err(|_| bad("not JSON"))?;
    let events = json
        .get("hooks")
        .and_then(Value::as_object)
        .ok_or_else(|| bad("no hooks object"))?;
    let mut entries = Vec::new();
    for (event, groups) in events {
        for group in groups
            .as_array()
            .ok_or_else(|| bad("event is not a list"))?
        {
            let hooks = group.get("hooks").and_then(Value::as_array);
            let command = match hooks.map(Vec::as_slice) {
                Some([hook]) => hook.get("command").and_then(Value::as_str),
                _ => None,
            };
            let command = command.ok_or_else(|| bad("group needs exactly one command"))?;
            entries.push(ManagedHookEntry {
                event: event.clone(),
                matcher: group
                    .get("matcher")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                command: command.to_owned(),
                sha256: sha256_hex(canonical_json(group).as_bytes()),
            });
        }
    }
    entries.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
    Ok(entries)
}

fn sort_key(entry: &ManagedHookEntry) -> (&str, Option<&str>, &str) {
    (&entry.event, entry.matcher.as_deref(), &entry.command)
}

/// The manifest hash of Skill files: SHA-256 over one `path TAB sha256 LF`
/// line per file, in ascending byte order of `path`.
pub fn skill_manifest_hash(files: &[ManagedFile]) -> String {
    let mut sorted: Vec<&ManagedFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut hasher = Sha256::new();
    for file in sorted {
        hasher.update(format!("{}\t{}\n", file.path, file.sha256).as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// The hash of managed Hook groups: SHA-256 over one
/// `event TAB matcher TAB command TAB sha256 LF` line per entry, in the order
/// of [`hook_managed_entries`]. A missing matcher is written as an empty field.
pub fn hook_manifest_hash(entries: &[ManagedHookEntry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        let matcher = entry.matcher.as_deref().unwrap_or("");
        let line = format!(
            "{}\t{matcher}\t{}\t{}\n",
            entry.event, entry.command, entry.sha256
        );
        hasher.update(line.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// JSON text with object keys sorted at every depth and no whitespace. Two
/// documents that differ only in key order produce the same text.
pub fn canonical_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut text = String::from("{");
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    text.push(',');
                }
                let _ = write!(
                    text,
                    "{}:{}",
                    Value::String((*key).clone()),
                    canonical_json(&map[key.as_str()])
                );
            }
            text.push('}');
            text
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        scalar => scalar.to_string(),
    }
}
