//! Merging the managed Hook groups into an agent settings file, and removing
//! them again. Both are pure functions of the file text: only the managed
//! groups change, every other key and Hook stays. Conflicts are returned, never
//! resolved: a managed group the user edited or deleted, an equal group Agent
//! Board did not install, or a suspicious `agboard` command stops the change.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::duplicates::{Found, find_hooks, same_hook};
use super::registry::ManagedHookEntry;
use super::template::TemplateGroup;

/// Why a change was stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// A managed Hook group differs from what was installed.
    ModifiedManaged,
    /// A managed Hook group was deleted.
    MissingManaged,
    /// An equal Hook that Agent Board did not install.
    UnmanagedDuplicate,
    /// An `agboard` command whose meaning cannot be confirmed.
    Suspicious,
    /// A settings file that cannot be edited safely.
    Invalid,
    /// A Skill file differs from what was installed.
    SkillModified,
    /// A managed Skill file is missing.
    SkillMissing,
    /// A file the user added to the Skill directory.
    SkillExtraFile,
    /// A symbolic link where Agent Board needs a directory or a file.
    Symlink,
    /// Skill content that Agent Board did not install.
    UnmanagedSkill,
    /// The registry cannot be used.
    Registry,
}

/// One reason a change was stopped, with the file it concerns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub kind: ConflictKind,
    pub path: PathBuf,
    pub detail: String,
}

impl Conflict {
    pub fn new(kind: ConflictKind, path: &Path, detail: String) -> Self {
        Conflict {
            kind,
            path: path.to_path_buf(),
            detail,
        }
    }
}

/// The outcome of editing one settings file.
#[derive(Debug, Default)]
pub struct HookEdit {
    /// The new file text, or `None` when the file stays as it is.
    pub text: Option<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub conflicts: Vec<Conflict>,
}

/// Adds the template groups that are missing, updates managed groups that are
/// older than the template, and removes obsolete managed groups. `recorded`
/// is what the registry says Agent Board installed in this file. A group that
/// is not recorded but that `adopt` accepts as the template written by hand
/// is taken over: replaced by the template group, or kept when it is equal.
pub fn merge_hooks(
    path: &Path,
    text: Option<&str>,
    template: &[TemplateGroup],
    recorded: &[ManagedHookEntry],
    adopt: &dyn Fn(&Found, &ManagedHookEntry) -> bool,
) -> HookEdit {
    let mut edit = HookEdit::default();
    let Some((mut root, found)) = load(path, text, &mut edit) else {
        return edit;
    };
    let mut handled = vec![false; found.len()];
    let (mut inserts, mut replaces, mut removals) = (Vec::new(), Vec::new(), Vec::new());
    for t in template {
        let rec = recorded.iter().find(|r| same_entry(r, &t.entry));
        let mut hits: Vec<usize> = (0..found.len())
            .filter(|&i| same_hook(&found[i], &t.entry))
            .collect();
        if hits.is_empty() && rec.is_none() {
            hits = (0..found.len())
                .filter(|&i| !handled[i] && adopt(&found[i], &t.entry))
                .collect();
        }
        hits.iter().for_each(|&i| handled[i] = true);
        let label = describe(&t.entry);
        match (hits.as_slice(), rec) {
            ([], None) => inserts.push(t),
            ([], Some(_)) => edit.conflicts.push(Conflict::new(
                ConflictKind::MissingManaged,
                path,
                format!("{label} was installed by Agent Board and is gone."),
            )),
            ([i], Some(r)) if found[*i].group_sha != r.sha256 => {
                edit.conflicts.push(Conflict::new(
                    ConflictKind::ModifiedManaged,
                    path,
                    format!("{label} was edited after Agent Board installed it."),
                ))
            }
            ([i], Some(r)) => {
                if r.sha256 != t.entry.sha256 {
                    replaces.push((&found[*i], t));
                }
            }
            ([i], None) if adopt(&found[*i], &t.entry) => {
                if found[*i].group_sha != t.entry.sha256 {
                    replaces.push((&found[*i], t));
                }
            }
            (_, _) => edit.conflicts.push(Conflict::new(
                ConflictKind::UnmanagedDuplicate,
                path,
                format!("{label} is already registered and Agent Board did not install it."),
            )),
        }
    }
    for (i, hook) in found.iter().enumerate().filter(|(i, _)| !handled[*i]) {
        match recorded.iter().find(|r| same_hook(hook, r)) {
            Some(r) if r.sha256 == hook.group_sha => removals.push(hook),
            Some(_) => edit.conflicts.push(Conflict::new(
                ConflictKind::ModifiedManaged,
                path,
                format!(
                    "{} was edited after Agent Board installed it.",
                    describe(&entry_of(hook, i))
                ),
            )),
            None => edit.conflicts.push(suspicious(path, hook)),
        }
    }
    if !edit.conflicts.is_empty() {
        return edit;
    }
    for (hook, t) in &replaces {
        root["hooks"][&hook.event][hook.group_index] = t.group.clone();
        edit.added.push(format!("update {}", describe(&t.entry)));
    }
    remove_groups(&mut root, &removals, &mut edit);
    for t in &inserts {
        let hooks = root
            .as_object_mut()
            .map(|o| o.entry("hooks").or_insert_with(|| json!({})));
        if let Some(Value::Object(events)) = hooks {
            let list = events
                .entry(t.entry.event.clone())
                .or_insert_with(|| json!([]));
            if let Some(list) = list.as_array_mut() {
                list.push(t.group.clone());
            }
        }
        edit.added.push(format!("add {}", describe(&t.entry)));
    }
    if !edit.added.is_empty() || !edit.removed.is_empty() {
        edit.text = Some(to_text(&root));
    }
    edit
}

/// Removes the recorded managed groups from the file. A group that is already
/// gone is not an error; an edited one is a conflict.
pub fn remove_hooks(path: &Path, text: Option<&str>, recorded: &[ManagedHookEntry]) -> HookEdit {
    let mut edit = HookEdit::default();
    let Some((mut root, found)) = load(path, text, &mut edit) else {
        return edit;
    };
    let mut removals = Vec::new();
    for r in recorded {
        let hits: Vec<&Found> = found.iter().filter(|f| same_hook(f, r)).collect();
        match hits.as_slice() {
            [] => {}
            [hook] if hook.group_sha == r.sha256 => removals.push(*hook),
            [_] => edit.conflicts.push(Conflict::new(
                ConflictKind::ModifiedManaged,
                path,
                format!("{} was edited after Agent Board installed it.", describe(r)),
            )),
            _ => edit.conflicts.push(Conflict::new(
                ConflictKind::UnmanagedDuplicate,
                path,
                format!("{} is registered more than once.", describe(r)),
            )),
        }
    }
    if edit.conflicts.is_empty() && !removals.is_empty() {
        remove_groups(&mut root, &removals, &mut edit);
        edit.text = Some(to_text(&root));
    }
    edit
}

/// Parses `text` and finds the `agboard` commands, or records why not.
fn load(path: &Path, text: Option<&str>, edit: &mut HookEdit) -> Option<(Value, Vec<Found>)> {
    let invalid = |detail: String| Conflict::new(ConflictKind::Invalid, path, detail);
    let root: Value = match text {
        None => json!({}),
        Some(text) => {
            match serde_json::from_str(text) {
                Ok(value) => value,
                Err(error) => {
                    edit.conflicts.push(invalid(format!("not valid JSON: {error}. Fix it by hand; Agent Board does not repair settings.")));
                    return None;
                }
            }
        }
    };
    if !root.is_object() {
        edit.conflicts
            .push(invalid("the top level must be a JSON object.".into()));
        return None;
    }
    match find_hooks(&root) {
        Ok(found) => Some((root, found)),
        Err(reason) => {
            edit.conflicts.push(invalid(format!(
                "{reason}. Agent Board does not edit a hooks block it cannot read."
            )));
            None
        }
    }
}

/// Deletes the given groups (highest index first so indexes stay valid) and
/// drops events and the `hooks` key when they become empty.
fn remove_groups(root: &mut Value, hooks: &[&Found], edit: &mut HookEdit) {
    let mut sorted: Vec<&&Found> = hooks.iter().collect();
    sorted.sort_by(|a, b| (&b.event, b.group_index).cmp(&(&a.event, a.group_index)));
    sorted.dedup_by(|a, b| a.event == b.event && a.group_index == b.group_index);
    for hook in sorted {
        if let Some(list) = root["hooks"][&hook.event].as_array_mut() {
            list.remove(hook.group_index);
        }
        edit.removed
            .push(format!("remove {} hook `{}`", hook.event, hook.command));
    }
    if let Some(Value::Object(events)) = root.get_mut("hooks") {
        events.retain(|_, groups| groups.as_array().is_none_or(|list| !list.is_empty()));
        if events.is_empty() {
            root.as_object_mut().map(|o| o.remove("hooks"));
        }
    }
}

fn same_entry(a: &ManagedHookEntry, b: &ManagedHookEntry) -> bool {
    a.event == b.event && a.matcher == b.matcher && a.command == b.command
}

fn entry_of(hook: &Found, _index: usize) -> ManagedHookEntry {
    ManagedHookEntry {
        event: hook.event.clone(),
        matcher: hook.matcher.clone(),
        command: hook.command.clone(),
        sha256: hook.group_sha.clone(),
    }
}

fn describe(entry: &ManagedHookEntry) -> String {
    match &entry.matcher {
        Some(m) => format!("{} hook [{m}] `{}`", entry.event, entry.command),
        None => format!("{} hook `{}`", entry.event, entry.command),
    }
}

fn suspicious(path: &Path, hook: &Found) -> Conflict {
    Conflict::new(
        ConflictKind::Suspicious,
        path,
        format!(
            "{} runs `{}`, an agboard command Agent Board cannot confirm. Remove or tidy it by hand.",
            hook.event, hook.command
        ),
    )
}

/// Pretty JSON with a trailing newline. Keys come out sorted, as in setup.
fn to_text(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text
}
