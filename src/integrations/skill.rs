//! Planning the Skill directory: what is installed now, whether it is still
//! what Agent Board wrote, and the files of the new version. Nothing is
//! written here. A Skill directory that holds anything Agent Board did not
//! install, a symbolic link, or an edited managed file is a conflict.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use super::assets::{EmbeddedBundle, sha256_hex, skill_manifest_hash};
use super::merge::{Conflict, ConflictKind};
use super::plan::{OpKind, Payload, PlannedOp};
use super::registry::{InstallationRecord, ManagedFile};

/// What planning decided for one Skill directory.
#[derive(Debug, Default)]
pub struct SkillPlan {
    /// The change to make, or `None` when the directory needs none.
    pub op: Option<PlannedOp>,
    /// The files the directory holds after the change, as the registry records them.
    pub files: Vec<ManagedFile>,
    pub manifest_hash: String,
    pub conflicts: Vec<Conflict>,
    /// `dir` is a symbolic link to this folder, which already holds exactly
    /// the bundled Skill. It is left as it is and not recorded, so that no
    /// later run writes through the link.
    pub linked: Option<std::path::PathBuf>,
}

/// The files below `dir` (path with `/` separators, SHA-256), sorted. A
/// symbolic link or another special entry is an error.
pub fn list_files(dir: &Path) -> Result<Vec<ManagedFile>, String> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<ManagedFile>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|error| error.to_string())?;
        for entry in entries {
            let path = entry.map_err(|error| error.to_string())?.path();
            let kind = fs::symlink_metadata(&path)
                .map_err(|error| error.to_string())?
                .file_type();
            if kind.is_dir() {
                walk(base, &path, out)?;
            } else if kind.is_file() {
                let bytes = fs::read(&path).map_err(|error| error.to_string())?;
                let rel = path.strip_prefix(base).map_err(|error| error.to_string())?;
                let rel = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(ManagedFile {
                    path: rel,
                    sha256: sha256_hex(&bytes),
                });
            } else {
                return Err(format!("{} is a link or a special file", path.display()));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(dir, dir, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Plans installing or updating the Skill at `dir`. `recorded` is the
/// registry record of this directory, if there is one.
pub fn plan_install(
    dir: &Path,
    recorded: Option<&InstallationRecord>,
    bundle: &EmbeddedBundle,
) -> SkillPlan {
    let files = bundle.skill_managed_files();
    let manifest_hash = skill_manifest_hash(&files);
    let mut plan = SkillPlan {
        files,
        manifest_hash,
        ..SkillPlan::default()
    };
    let current = match recorded {
        Some(record) => match verify_clean(dir, record) {
            Ok(hash) => Some(hash),
            Err(conflicts) => {
                plan.conflicts = conflicts;
                return plan;
            }
        },
        None => match fs::symlink_metadata(dir) {
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Ok(meta) if meta.file_type().is_symlink() => {
                let real = super::paths::resolve_links(dir);
                if list_files(&real).is_ok_and(|mut found| {
                    found.sort_by(|a, b| a.path.cmp(&b.path));
                    let mut wanted = plan.files.clone();
                    wanted.sort_by(|a, b| a.path.cmp(&b.path));
                    found == wanted
                }) {
                    plan.linked = Some(real);
                    return plan;
                }
                plan.conflicts.push(Conflict::new(
                    ConflictKind::Symlink,
                    dir,
                    "is a symbolic link to a folder that does not hold the same Skill; Agent Board does not install through it.".into(),
                ));
                return plan;
            }
            _ => {
                plan.conflicts.push(Conflict::new(ConflictKind::UnmanagedSkill, dir, "already exists and Agent Board did not install it. Move it away or remove it, then run connect again.".into()));
                return plan;
            }
        },
    };
    if current.as_deref() == Some(plan.manifest_hash.as_str()) {
        return plan;
    }
    let tree = bundle
        .skill_files()
        .into_iter()
        .map(|entry| {
            (
                entry.relative_path["skill/".len()..].to_owned(),
                entry.bytes.to_vec(),
            )
        })
        .collect();
    let verb = if current.is_some() {
        "update"
    } else {
        "install"
    };
    plan.op = Some(PlannedOp {
        kind: OpKind::Tree,
        path: dir.to_path_buf(),
        original_hash: current,
        planned_hash: Some(plan.manifest_hash.clone()),
        payload: Payload::Tree(tree),
        description: format!("{verb} the Skill at {}", dir.display()),
    });
    plan
}

/// Plans removing a managed Skill directory (a scope move).
pub fn plan_removal(dir: &Path, recorded: &InstallationRecord) -> SkillPlan {
    let mut plan = SkillPlan::default();
    match fs::symlink_metadata(dir) {
        Err(error) if error.kind() == ErrorKind::NotFound => return plan,
        _ => {}
    }
    match verify_clean(dir, recorded) {
        Ok(hash) => {
            plan.op = Some(PlannedOp {
                kind: OpKind::Tree,
                path: dir.to_path_buf(),
                original_hash: Some(hash),
                planned_hash: None,
                payload: Payload::Remove,
                description: format!("remove the Skill at {}", dir.display()),
            });
        }
        Err(conflicts) => plan.conflicts = conflicts,
    }
    plan
}

/// The manifest hash of `dir` when it holds exactly the files the record
/// lists with the recorded bytes; otherwise the conflicts.
fn verify_clean(dir: &Path, record: &InstallationRecord) -> Result<String, Vec<Conflict>> {
    let conflict = |kind, detail: String| vec![Conflict::new(kind, dir, detail)];
    match fs::symlink_metadata(dir) {
        Err(_) => {
            return Err(conflict(
                ConflictKind::SkillMissing,
                "was installed by Agent Board and is gone.".into(),
            ));
        }
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(conflict(
                ConflictKind::Symlink,
                "was replaced by a symbolic link.".into(),
            ));
        }
        Ok(meta) if !meta.is_dir() => {
            return Err(conflict(
                ConflictKind::UnmanagedSkill,
                "is not a directory.".into(),
            ));
        }
        Ok(_) => {}
    }
    let files = list_files(dir).map_err(|reason| conflict(ConflictKind::Symlink, reason))?;
    let mut conflicts = Vec::new();
    for wanted in &record.files {
        match files.iter().find(|f| f.path == wanted.path) {
            None => conflicts.push(Conflict::new(
                ConflictKind::SkillMissing,
                &dir.join(&wanted.path),
                "was installed by Agent Board and is gone.".into(),
            )),
            Some(f) if f.sha256 != wanted.sha256 => conflicts.push(Conflict::new(
                ConflictKind::SkillModified,
                &dir.join(&wanted.path),
                "was edited after Agent Board installed it.".into(),
            )),
            Some(_) => {}
        }
    }
    for file in files
        .iter()
        .filter(|f| !record.files.iter().any(|w| w.path == f.path))
    {
        conflicts.push(Conflict::new(
            ConflictKind::SkillExtraFile,
            &dir.join(&file.path),
            "was added to the Skill directory by someone else.".into(),
        ));
    }
    if conflicts.is_empty() {
        Ok(skill_manifest_hash(&files))
    } else {
        Err(conflicts)
    }
}
