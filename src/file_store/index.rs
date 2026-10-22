//! The serve-side index of the shared files (ARCHITECTURE.md, "更新通知").
//!
//! The index keeps every project's content version and its last read. A
//! project's version is a SHA-256 over the relative paths and contents of its
//! canonical files, so a save with the same bytes leaves it unchanged, and an
//! unchanged version is never read again. A project that cannot be read keeps
//! its last good view next to the error.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use super::layout;
use super::projection::{
    self, ChangeSet, Facet, Projection, invalid_changes, project_change, ready_changes,
};
use super::reader::{self, ProjectSnapshot};
use crate::domain::ProjectId;
use crate::error::AgboardError;

/// What the index knows about one project.
#[derive(Debug)]
pub enum ProjectEntry {
    /// The project was read; its tasks may still carry problems.
    Ready {
        view: Arc<ProjectSnapshot>,
        version: String,
        /// The Summary projection of `view`.
        projection: Arc<Projection>,
    },
    /// `project.json` could not be read. `last_good` keeps the previous read,
    /// so the screen can show it next to the error.
    Invalid {
        error: AgboardError,
        last_good: Option<Arc<ProjectSnapshot>>,
        version: String,
        /// The projection of `last_good`.
        projection: Option<Arc<Projection>>,
    },
}

impl ProjectEntry {
    pub fn version(&self) -> &str {
        match self {
            ProjectEntry::Ready { version, .. } | ProjectEntry::Invalid { version, .. } => version,
        }
    }

    /// The Summary projection of the read to show.
    pub fn projection(&self) -> Option<&Arc<Projection>> {
        match self {
            ProjectEntry::Ready { projection, .. } => Some(projection),
            ProjectEntry::Invalid { projection, .. } => projection.as_ref(),
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
    /// The changes found by the reloads since the last [`ProjectIndex::take_changes`].
    pending: Vec<ChangeSet>,
}

impl ProjectIndex {
    /// The catalog version: a hash of every project's ID and version. It
    /// changes when a project is added, removed, or its content changes.
    pub fn catalog_version(&self) -> &str {
        &self.catalog_version
    }

    /// The change sets that the reloads found since the last call, in the order they were found.
    /// The reloader announces them; a caller that only reloads may ignore them.
    pub fn take_changes(&mut self) -> Vec<ChangeSet> {
        std::mem::take(&mut self.pending)
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
    pub fn reload_all(&mut self, shared: &Path) -> Result<bool, AgboardError> {
        let ids = scan_ids(shared)?;
        let gone: Vec<ProjectId> = self
            .entries
            .keys()
            .filter(|id| !ids.contains(id))
            .cloned()
            .collect();
        for id in gone {
            self.entries.remove(&id);
            self.pending.push(project_change(&id, Facet::Deleted));
        }
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
            if self.entries.remove(id).is_some() {
                self.pending.push(project_change(id, Facet::Deleted));
            }
            return;
        }
        let previous = self.entries.get(id);
        let last_good = previous.and_then(|entry| entry.last_good().cloned());
        let old_projection = previous.and_then(|entry| entry.projection().cloned());
        let was_invalid = matches!(previous, Some(ProjectEntry::Invalid { .. }));
        let previous_version = previous.map(|entry| entry.version().to_string());
        // Snapshot takes index→project lock order and recovers any pending pair
        // before computing the version. Hashing first could mistake an
        // interrupted journal for an unchanged project and skip recovery.
        let (entry, changes) = match reader::read_snapshot(shared, id) {
            Ok(snapshot) => {
                let version = snapshot.version.clone();
                if previous_version.as_deref() == Some(version.as_str()) {
                    return;
                }
                let projection = Arc::new(projection::project(shared, &snapshot));
                let changes = ready_changes(old_projection.as_deref(), &projection, was_invalid);
                (
                    ProjectEntry::Ready {
                        view: Arc::new(snapshot),
                        version,
                        projection,
                    },
                    changes,
                )
            }
            Err(error) => {
                let version = project_version(&dir);
                let unchanged =
                    was_invalid && previous_version.as_deref() == Some(version.as_str());
                // Nothing can be told about the files of a project that cannot be read:
                // every resource it had is changed in every facet.
                let changes = if unchanged {
                    Vec::new()
                } else {
                    invalid_changes(old_projection.as_deref(), was_invalid)
                };
                (
                    ProjectEntry::Invalid {
                        error,
                        last_good,
                        version,
                        projection: old_projection,
                    },
                    changes,
                )
            }
        };
        self.entries.insert(id.clone(), entry);
        if !changes.is_empty() {
            self.pending.push(ChangeSet {
                project_id: id.clone(),
                changes,
            });
        }
    }

    /// Recompute the catalog version and report whether it changed.
    fn refresh_catalog(&mut self) -> bool {
        let version = catalog_version_of(self.entries.iter().map(|(id, e)| (id, e.version())));
        let changed = version != self.catalog_version;
        self.catalog_version = version;
        changed
    }
}

pub(super) use super::versions::hex_prefix;
pub use super::versions::{catalog_version_of, project_version, scan_ids};
