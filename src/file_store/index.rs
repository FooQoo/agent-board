//! The serve-side index of the shared files (ARCHITECTURE.md, "更新通知").
//!
//! The index keeps every project's content version and its last read. A
//! project's version is a SHA-256 over the relative paths and contents of its
//! canonical files, so a save with the same bytes leaves it unchanged, and an
//! unchanged version is never read again. A project that cannot be read keeps
//! its last good view next to the error.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use super::io;
use super::layout;
use super::reader::{self, ProjectSnapshot};
use crate::domain::ProjectId;
use crate::error::SkanError;

/// What the index knows about one project.
#[derive(Debug)]
pub enum ProjectEntry {
    /// The project was read; its cards may still carry problems.
    Ready {
        view: Arc<ProjectSnapshot>,
        version: String,
    },
    /// `project.json` could not be read. `last_good` keeps the previous read,
    /// so the screen can show it next to the error.
    Invalid {
        error: SkanError,
        last_good: Option<Arc<ProjectSnapshot>>,
        version: String,
    },
}

impl ProjectEntry {
    pub fn version(&self) -> &str {
        match self {
            ProjectEntry::Ready { version, .. } | ProjectEntry::Invalid { version, .. } => version,
        }
    }

    /// The read to show: the current one, or the last good one when invalid.
    pub fn last_good(&self) -> Option<&Arc<ProjectSnapshot>> {
        match self {
            ProjectEntry::Ready { view, .. } => Some(view),
            ProjectEntry::Invalid { last_good, .. } => last_good.as_ref(),
        }
    }
}

/// The index of every project in one shared folder.
#[derive(Debug, Default)]
pub struct ProjectIndex {
    entries: BTreeMap<ProjectId, ProjectEntry>,
    catalog_version: String,
}

impl ProjectIndex {
    /// The catalog version: a hash of every project's ID and version. It
    /// changes when a project is added, removed, or its content changes.
    pub fn catalog_version(&self) -> &str {
        &self.catalog_version
    }

    pub fn entry(&self, id: &ProjectId) -> Option<&ProjectEntry> {
        self.entries.get(id)
    }

    /// Every project entry, in ID order.
    pub fn entries(&self) -> impl Iterator<Item = (&ProjectId, &ProjectEntry)> {
        self.entries.iter()
    }

    /// Read every project folder again. Returns whether the catalog version
    /// changed. A failure to list the projects leaves the index as it was.
    pub fn reload_all(&mut self, shared: &Path) -> Result<bool, SkanError> {
        let ids = scan_ids(shared)?;
        self.entries.retain(|id, _| ids.contains(id));
        for id in &ids {
            self.reload_one(shared, id);
        }
        Ok(self.refresh_catalog())
    }

    /// Read one project folder again (or drop it when the folder is gone).
    /// Returns whether the catalog version changed.
    pub fn reload_project(&mut self, shared: &Path, id: &ProjectId) -> bool {
        self.reload_one(shared, id);
        self.refresh_catalog()
    }

    /// Recompute one project's entry. An unchanged version keeps the entry as it is.
    fn reload_one(&mut self, shared: &Path, id: &ProjectId) {
        let dir = layout::project_dir(shared, id);
        if !dir.is_dir() {
            self.entries.remove(id);
            return;
        }
        let version = project_version(&dir);
        let previous = self.entries.get(id);
        if previous.is_some_and(|entry| entry.version() == version) {
            return;
        }
        let last_good = previous.and_then(|entry| entry.last_good().cloned());
        let entry = match reader::read_snapshot(shared, id) {
            Ok(snapshot) => ProjectEntry::Ready {
                view: Arc::new(snapshot),
                version,
            },
            Err(error) => ProjectEntry::Invalid {
                error,
                last_good,
                version,
            },
        };
        self.entries.insert(id.clone(), entry);
    }

    /// Recompute the catalog version and report whether it changed.
    fn refresh_catalog(&mut self) -> bool {
        let version = catalog_version_of(self.entries.iter().map(|(id, e)| (id, e.version())));
        let changed = version != self.catalog_version;
        self.catalog_version = version;
        changed
    }
}

/// The catalog version of a list of `(project, version)` pairs, in the order
/// given (callers pass them in ID order).
pub fn catalog_version_of<'a>(
    projects: impl IntoIterator<Item = (&'a ProjectId, &'a str)>,
) -> String {
    let mut outer = Sha256::new();
    for (id, version) in projects {
        outer.update(id.as_str().as_bytes());
        outer.update([0]);
        outer.update(version.as_bytes());
        outer.update(b"\n");
    }
    hex_prefix(&outer.finalize())
}

/// The IDs of the project folders, in order. Only canonical folder names count.
pub fn scan_ids(shared: &Path) -> Result<Vec<ProjectId>, SkanError> {
    let dir = layout::projects_dir(shared);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let label = layout::shared_label(shared, &dir);
    let entries = fs::read_dir(&dir).map_err(|e| io::read_error(&label, e))?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io::read_error(&label, e))?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Ok(id) = ProjectId::from_str(&name)
            && entry.path().is_dir()
        {
            ids.push(id);
        }
    }
    ids.sort();
    Ok(ids)
}

/// The content version of one project folder: 32 lowercase hexadecimal
/// digits. It covers `project.json`, every epic's `epic.json` and `PLAN.md`,
/// every card's `task.json` and `TASK.md`, and the names (not the contents)
/// of the files in `assets/` and `evidence/`. Dot-prefixed names are skipped.
pub fn project_version(project_dir: &Path) -> String {
    let mut items: Vec<(String, Option<String>)> = Vec::new();
    let project_file = layout::project_file(project_dir);
    if project_file.is_file() {
        items.push(content_item(project_dir, &project_file));
    }
    for (dir, files) in [
        (
            layout::epics_dir(project_dir),
            &["epic.json", "PLAN.md"][..],
        ),
        (
            layout::tasks_dir(project_dir),
            &["task.json", "TASK.md"][..],
        ),
    ] {
        for folder in child_folders(&dir) {
            for name in files {
                let path = folder.join(name);
                if path.is_file() {
                    items.push(content_item(project_dir, &path));
                }
            }
            for sub in ["assets", "evidence"] {
                for path in child_files(&folder.join(sub)) {
                    items.push((layout::project_label(project_dir, &path), None));
                }
            }
        }
    }
    items.sort_by(|a, b| a.0.cmp(&b.0));

    let mut outer = Sha256::new();
    for (label, digest) in items {
        outer.update(label.as_bytes());
        outer.update([0]);
        if let Some(digest) = digest {
            outer.update(digest.as_bytes());
        }
        outer.update(b"\n");
    }
    hex_prefix(&outer.finalize())
}

/// A file's relative label and the SHA-256 of its bytes. A file that cannot be
/// read still counts, with a marker, so its failure changes the version.
fn content_item(project_dir: &Path, path: &Path) -> (String, Option<String>) {
    let digest = match fs::read(path) {
        Ok(bytes) => hex_full(&Sha256::digest(&bytes)),
        Err(_) => "unreadable".to_string(),
    };
    (layout::project_label(project_dir, path), Some(digest))
}

fn child_folders(dir: &Path) -> Vec<PathBuf> {
    child_entries(dir, true)
}

fn child_files(dir: &Path) -> Vec<PathBuf> {
    child_entries(dir, false)
}

fn child_entries(dir: &Path, folders: bool) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| {
            if folders {
                path.is_dir()
            } else {
                path.is_file()
            }
        })
        .collect();
    found.sort();
    found
}

fn hex_full(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The first 16 bytes of a digest as 32 lowercase hexadecimal digits.
fn hex_prefix(digest: &[u8]) -> String {
    hex_full(&digest[..16])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_32_hex_digits_and_ignore_modification_times() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("p");
        fs::create_dir_all(project.join("tasks/1")).unwrap();
        fs::write(project.join("project.json"), "{}").unwrap();
        fs::write(project.join("tasks/1/TASK.md"), "text").unwrap();
        let first = project_version(&project);
        assert_eq!(first.len(), 32);

        // Rewriting the same bytes changes the file's time, not the version.
        fs::write(project.join("tasks/1/TASK.md"), "text").unwrap();
        assert_eq!(project_version(&project), first);

        fs::write(project.join("tasks/1/TASK.md"), "other").unwrap();
        assert_ne!(project_version(&project), first);
    }

    #[test]
    fn attachment_names_count_but_their_contents_do_not() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("p");
        fs::create_dir_all(project.join("tasks/1/assets")).unwrap();
        let empty = project_version(&project);
        fs::write(project.join("tasks/1/assets/a1.png"), b"one").unwrap();
        let named = project_version(&project);
        assert_ne!(named, empty);
        fs::write(project.join("tasks/1/assets/a1.png"), b"two").unwrap();
        assert_eq!(project_version(&project), named);
    }

    #[test]
    fn dot_prefixed_names_are_not_part_of_the_version() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("p");
        fs::create_dir_all(project.join("tasks/1")).unwrap();
        fs::write(project.join("tasks/1/TASK.md"), "text").unwrap();
        let before = project_version(&project);
        fs::write(project.join("tasks/1/.TASK.md.tmp-0123"), "half").unwrap();
        assert_eq!(project_version(&project), before);
    }
}
