//! The default epics a project is offered once.

use chrono::{DateTime, Utc};

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::NewEpic;
use crate::file_store::reader;

use super::super::lock_project;

/// The epics a project is offered once: BUG and ENHANCEMENT. After they are
/// created they are ordinary epics, so they can be edited and deleted.
pub const DEFAULT_EPICS: [(&str, &str, &str); 2] = [
    ("BUG", "Bug", "#D64545"),
    ("ENHANCEMENT", "Enhancement", "#3B82F6"),
];

impl FileStore {
    /// Create the default epics the project does not have yet, then record in
    /// `project.json` that they were offered. An epic that already has the
    /// same ID is left as it is.
    pub fn seed_default_epics(
        &self,
        project: &ProjectId,
        now: DateTime<Utc>,
    ) -> Result<(), AgboardError> {
        if reader::read_project_file(self.shared_dir(), project)?.default_epics_seeded {
            return Ok(());
        }
        for (id, name, color) in DEFAULT_EPICS {
            let new = NewEpic {
                id: id.into(),
                name: name.into(),
                color: Some(color.into()),
                is_draft: false,
                document: None,
            };
            match self.create_epic(project, new, now) {
                Ok(_) | Err(AgboardError::EpicIdTaken { .. }) => {}
                Err(error) => return Err(error),
            }
        }
        let shared = self.shared_dir();
        let (dir, _lock) = lock_project(shared, project)?;
        let mut file = reader::read_project_file(shared, project)?;
        file.default_epics_seeded = true;
        let path = layout::project_file(&dir);
        io::write_json(&path, &file, &layout::shared_label(shared, &path))
    }

    /// Offer the default epics to every project that has not been offered them,
    /// so existing projects get them on the first start after the update. A
    /// project that fails is left unchanged and is tried again on the next start.
    pub fn seed_unseeded_projects(&self, now: DateTime<Utc>) {
        let Ok(projects) = self.projects() else {
            return;
        };
        for meta in projects {
            let shared = self.shared_dir();
            let unseeded = matches!(
                reader::read_project_file(shared, &meta.id),
                Ok(file) if !file.default_epics_seeded
            );
            if unseeded {
                let _ = self.seed_default_epics(&meta.id, now);
            }
        }
    }
}
