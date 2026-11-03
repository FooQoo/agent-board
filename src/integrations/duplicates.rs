//! Finding Agent Board's Hook registrations in agent settings. A Hook is
//! identified by agent, event, matcher, and the fixed command (whitespace
//! normalized). Any other command that mentions `agboard` is *suspicious*:
//! its meaning cannot be confirmed, so the change stops.
//!
//! Only fixed files are read: the Global files, the files of the current
//! bound root and its ancestors, and the paths the registry records. No
//! directory is scanned.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::Value;
use toml_edit::DocumentMut;

use super::assets::{canonical_json, sha256_hex};
use super::merge::{Conflict, ConflictKind};
use super::paths::{PathEnv, placement, resolve_links};
use super::registry::{InstallationRecord, ManagedHookEntry, Registry};
use super::template::TemplateGroup;
use super::toml_json::item_to_json;
use super::types::{Agent, Component, Scope};
use super::update::in_reach;

/// One `agboard` command found in a settings file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub event: String,
    pub matcher: Option<String>,
    pub command: String,
    pub group_index: usize,
    /// How many hooks the group holds.
    pub group_hooks: usize,
    /// SHA-256 of the group's canonical JSON.
    pub group_sha: String,
}

/// The command with runs of whitespace collapsed to one space.
pub fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether `found` is the same Hook as `entry`.
pub fn same_hook(found: &Found, entry: &ManagedHookEntry) -> bool {
    found.event == entry.event
        && found.matcher == entry.matcher
        && normalize_command(&found.command) == normalize_command(&entry.command)
}

/// Every command in `root["hooks"]` that mentions `agboard`. A hooks block
/// of an unexpected shape is an error: it cannot be edited safely.
pub fn find_hooks(root: &Value) -> Result<Vec<Found>, String> {
    let Some(hooks) = root.get("hooks") else {
        return Ok(Vec::new());
    };
    let events = hooks.as_object().ok_or("hooks must be an object")?;
    let mut found = Vec::new();
    for (event, groups) in events {
        let groups = groups
            .as_array()
            .ok_or_else(|| format!("hooks.{event} must be an array"))?;
        for (group_index, group) in groups.iter().enumerate() {
            let group_object = group
                .as_object()
                .ok_or_else(|| format!("hooks.{event}[{group_index}] must be an object"))?;
            let list = match group_object.get("hooks") {
                None => continue,
                Some(list) => list.as_array().ok_or_else(|| {
                    format!("hooks.{event}[{group_index}].hooks must be an array")
                })?,
            };
            for hook in list {
                let Some(command) = hook.get("command").and_then(Value::as_str) else {
                    continue;
                };
                if command.contains("agboard") {
                    found.push(Found {
                        event: event.clone(),
                        matcher: group_object
                            .get("matcher")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        command: command.to_owned(),
                        group_index,
                        group_hooks: list.len(),
                        group_sha: sha256_hex(canonical_json(group).as_bytes()),
                    });
                }
            }
        }
    }
    Ok(found)
}

/// The `agboard` commands of one file: a JSON settings file, or the inline
/// `[hooks]` of a Codex `config.toml`. A missing file has none.
pub fn scan_file(path: &Path) -> Result<Vec<Found>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("cannot be read: {error}")),
    };
    let root = if path.extension().is_some_and(|ext| ext == "toml") {
        let doc: DocumentMut = text.parse().map_err(|error: toml_edit::TomlError| {
            format!("not valid TOML: {}", error.message())
        })?;
        match doc.get("hooks") {
            Some(hooks) => {
                let mut hooks = item_to_json(hooks);
                // `[hooks.state."<file>:<event>:..."]` is where Codex records
                // the Hooks the person trusted, not a Hook event.
                if let Some(events) = hooks.as_object_mut() {
                    events.remove("state");
                }
                serde_json::json!({ "hooks": hooks })
            }
            None => serde_json::json!({}),
        }
    } else {
        serde_json::from_str(&text).map_err(|error| format!("not valid JSON: {error}"))?
    };
    find_hooks(&root)
}

/// The result of looking for Hooks outside the target file.
#[derive(Debug, Default)]
pub struct HookCheck {
    /// Managed registrations of the same agent in other files: a scope move
    /// removes them in the same transaction.
    pub sources: Vec<InstallationRecord>,
    pub conflicts: Vec<Conflict>,
    pub warnings: Vec<String>,
    /// Hand-written copies of the template for this project in other JSON
    /// files, by file: connect removes them in the same transaction.
    pub adopted: Vec<(PathBuf, Vec<ManagedHookEntry>)>,
}

/// Decides whether a found Hook is a template entry written by hand.
pub type Adopt<'a> = &'a dyn Fn(&Found, &ManagedHookEntry) -> bool;

/// Whether connect takes `record` over when it installs `component` into
/// `target_scope` for the bound root `root`. A scope move takes over this
/// root's own record in the other scope, and any Global record. Another
/// root's Project record is left alone, except that a Global Hook would
/// duplicate it, so that one moves.
pub fn is_move_source(
    record: &InstallationRecord,
    target_scope: Scope,
    root: Option<&Path>,
) -> bool {
    let other_root = record.scope == Scope::Project && record.bound_root.as_deref() != root;
    match record.component {
        Component::Hook => !(other_root && target_scope == Scope::Project),
        Component::Skill => !other_root,
    }
}

/// Looks for Agent Board Hooks of `agent` outside `target`. Registrations the
/// registry records for this agent are known; those that `is_move_source`
/// accepts are move sources. `adopt` is given when connect plans: then every
/// recorded file is read, and a hand-written copy of the template in an
/// unrecorded JSON file is taken over. Every other one stops the change.
pub fn check_other_registrations(
    env: &PathEnv,
    agent: Agent,
    (target, target_scope): (&Path, Scope),
    scan_root: Option<&Path>,
    registry: &Registry,
    template: &[TemplateGroup],
    adopt: Option<Adopt>,
) -> HookCheck {
    let scan_all_recorded = adopt.is_some();
    let mut check = HookCheck::default();
    let target_real = resolve_links(target);
    let recorded: Vec<&InstallationRecord> = registry
        .installations
        .iter()
        .filter(|r| r.agent == agent && r.component == Component::Hook)
        .filter(|r| resolve_links(&r.resolved_path) != target_real)
        .collect();
    let recorded_paths: BTreeSet<PathBuf> = recorded
        .iter()
        .map(|r| resolve_links(&r.resolved_path))
        .collect();
    let mut files = candidate_files(env, agent, scan_root);
    // Every recorded file is read only when connect plans; update reads the
    // registry for ownership but opens just the records it may change.
    files.extend(
        recorded
            .iter()
            .filter(|r| scan_all_recorded || in_reach(r, scan_root))
            .map(|r| r.resolved_path.clone()),
    );
    let mut seen = BTreeSet::new();
    for path in files {
        let real = resolve_links(&path);
        if real == target_real || !seen.insert(real.clone()) {
            continue;
        }
        let owner = recorded
            .iter()
            .find(|r| resolve_links(&r.resolved_path) == real);
        let found = match scan_file(&path) {
            Ok(found) => found,
            Err(reason) => {
                check
                    .warnings
                    .push(format!("{} {reason}; it was not checked.", path.display()));
                continue;
            }
        };
        for hook in found {
            let managed =
                owner.is_some_and(|r| r.managed_entries.iter().any(|e| same_hook(&hook, e)));
            if managed {
                continue;
            }
            let json = path.extension().is_some_and(|ext| ext == "json");
            if let Some(adopt) = adopt.filter(|_| json && owner.is_none())
                && template.iter().any(|t| adopt(&hook, &t.entry))
            {
                let entry = ManagedHookEntry {
                    event: hook.event.clone(),
                    matcher: hook.matcher.clone(),
                    command: hook.command.clone(),
                    sha256: hook.group_sha.clone(),
                };
                match check.adopted.iter_mut().find(|(p, _)| *p == path) {
                    Some((_, entries)) => entries.push(entry),
                    None => check.adopted.push((path.clone(), vec![entry])),
                }
                continue;
            }
            let exact = template.iter().any(|t| same_hook(&hook, &t.entry));
            let (kind, what) = if exact && !recorded_paths.contains(&real) {
                (
                    ConflictKind::UnmanagedDuplicate,
                    "an Agent Board Hook that Agent Board did not install",
                )
            } else {
                (
                    ConflictKind::Suspicious,
                    "an agboard command whose meaning cannot be confirmed",
                )
            };
            check.conflicts.push(Conflict::new(
                kind,
                &path,
                format!(
                    "{} {}: {what} (`{}`).",
                    hook.event,
                    hook.matcher.as_deref().unwrap_or("(no matcher)"),
                    hook.command
                ),
            ));
        }
    }
    check.sources = recorded
        .into_iter()
        .filter(|r| is_move_source(r, target_scope, scan_root))
        .cloned()
        .collect();
    check
}

/// The fixed files, besides the target, that can hold a Hook that loads in the
/// same sessions: the Global files, and the bound root's and its ancestors'.
fn candidate_files(env: &PathEnv, agent: Agent, scan_root: Option<&Path>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let global = placement(env, agent, Component::Hook, Scope::Global, None).ok();
    let (dir_name, names): (&str, [&str; 2]) = match agent {
        Agent::Claude => (".claude", ["settings.json", "settings.local.json"]),
        Agent::Codex => (".codex", ["hooks.json", "config.toml"]),
    };
    if let Some(dir) = global.as_deref().and_then(Path::parent) {
        files.extend(names.iter().map(|name| dir.join(name)));
    }
    if let Some(root) = scan_root {
        for ancestor in root.ancestors() {
            files.extend(names.iter().map(|name| ancestor.join(dir_name).join(name)));
        }
    }
    files
}
