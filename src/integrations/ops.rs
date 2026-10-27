//! Building blocks of one agent's transaction: the registry write, the
//! journal entry of each target, and the file system helpers that create the
//! backup file, the staged Skill tree, and the transaction ID.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::journal::JournalOp;
use super::plan::{OpKind, Payload, PlannedOp, RegistryChange};
use super::registry::Registry;

/// The registry write for `changes`, or `None` when the registry stays as it is.
pub(super) fn registry_op(
    path: &Path,
    changes: &[RegistryChange],
) -> Result<Option<PlannedOp>, String> {
    if changes.is_empty() {
        return Ok(None);
    }
    let original = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{} cannot be read: {e}", path.display())),
    };
    let mut registry = Registry::read(path)
        .map_err(|e| format!("{e} The registry was not rewritten."))?
        .unwrap_or_default();
    for change in changes {
        match change {
            RegistryChange::Upsert(record) => {
                let same = |r: &super::registry::InstallationRecord| {
                    (r.agent, r.component, r.scope, &r.bound_root)
                        == (
                            record.agent,
                            record.component,
                            record.scope,
                            &record.bound_root,
                        )
                };
                registry.installations.retain(|r| !same(r));
                registry.installations.push(record.clone());
            }
            RegistryChange::Remove {
                agent,
                component,
                scope,
                bound_root,
            } => {
                registry.installations.retain(|r| {
                    (r.agent, r.component, r.scope, &r.bound_root)
                        != (*agent, *component, *scope, bound_root)
                });
            }
        }
    }
    let bytes = registry.to_json().into_bytes();
    if original.as_deref() == Some(bytes.as_slice()) {
        return Ok(None);
    }
    Ok(Some(PlannedOp {
        kind: OpKind::File,
        path: path.to_path_buf(),
        original_hash: original.as_deref().map(super::assets::sha256_hex),
        planned_hash: Some(super::assets::sha256_hex(&bytes)),
        payload: Payload::File(bytes),
        description: format!("record the installation in {}", path.display()),
    }))
}

/// The hidden folder that holds the backup and the staging copy of a Skill
/// folder: `.agboard-backups` in the parent of the skills root, so that agents
/// do not load them as Skills and a rename stays on one file system.
pub(super) fn skill_backup_dir(skill: &Path) -> Option<PathBuf> {
    let skills_root = skill.parent()?;
    Some(skills_root.parent()?.join(BACKUP_DIR))
}

/// The folder name for Skill backups and staging copies.
const BACKUP_DIR: &str = ".agboard-backups";

pub(super) fn journal_op(op: &PlannedOp, txn: &str, index: usize) -> JournalOp {
    let name = op
        .path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    // File backups sit beside the file; Skill folders go to the hidden folder.
    let hidden = (op.kind == OpKind::Tree)
        .then(|| skill_backup_dir(&op.path))
        .flatten();
    let place = |file: String| match &hidden {
        Some(dir) => dir.join(file),
        None => op.path.with_file_name(file),
    };
    let backup_name = place(format!("{name}.agboard-backup-{txn}-{index}"));
    let stage_name = place(format!(".{name}.agboard-stage-{txn}-{index}"));
    JournalOp {
        kind: op.kind,
        path: op.path.clone(),
        original_hash: op.original_hash.clone(),
        planned_hash: op.planned_hash.clone(),
        backup: op.original_hash.as_ref().map(|_| backup_name),
        stage: matches!(op.payload, Payload::Tree(_)).then_some(stage_name),
    }
}

pub(super) fn build_tree(stage: &Path, files: &[(String, Vec<u8>)]) -> std::io::Result<()> {
    let _ = fs::remove_dir_all(stage);
    for (rel, bytes) in files {
        let path = stage.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
    }
    Ok(())
}

/// Creates `path` (it must not exist) with `bytes` and `mode`.
pub(super) fn write_new_file(path: &Path, bytes: &[u8], mode: u32) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(mode);
    #[cfg(not(unix))]
    let _ = mode;
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

pub(super) fn unique_id() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{stamp}-{}", std::process::id())
}
