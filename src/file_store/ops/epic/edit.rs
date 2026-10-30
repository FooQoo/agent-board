//! Creating, reading and updating an epic.

use std::fs;

use chrono::{DateTime, Utc};

use crate::domain::{Changed, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::frontmatter;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{EpicFile, EpicUpdate, EpicView, NewEpic};
use crate::file_store::reader;
use crate::file_store::validate::{self, EpicId};

use super::super::{lock_project, stamp};
use super::{
    document_to_store, epic_view, random_color, read_document, read_epic_file, save_document,
    save_epic, view_of,
};

impl FileStore {
    /// Create an epic. The ID is folded to uppercase and checked, the color is
    /// stored as `#RRGGBB`, and the folder is built under a temporary name and
    /// renamed into place. An existing folder of that ID is `epic_id_taken`.
    pub fn create_epic(
        &self,
        project: &ProjectId,
        new: NewEpic,
        now: DateTime<Utc>,
    ) -> Result<EpicView, AgboardError> {
        let id = EpicId::normalize(&new.id)?;
        let name = validate::validate_epic_name(&new.name)?;
        let document = document_to_store(new.document)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let color = match new.color.as_deref() {
            Some(text) => validate::normalize_color(text)?,
            None => {
                let used = reader::read_epics(shared, &project_dir).0;
                random_color(used.iter().map(|epic| epic.color.as_str()))?
            }
        };

        let target = layout::epic_dir(&project_dir, &id);
        if fs::symlink_metadata(&target).is_ok() {
            return Err(AgboardError::EpicIdTaken { id: id.to_string() });
        }
        let label = layout::shared_label(shared, &target);
        let document_label = format!("{label}/EPIC.md");
        validate::ensure_document_body(&document, &document_label)?;

        let epics = layout::epics_dir(&project_dir);
        fs::create_dir_all(&epics).map_err(|e| io::write_error(&label, e))?;
        let temp = epics.join(format!(
            ".new-{}",
            io::random_hex(16).map_err(|e| io::write_error(&label, e))?
        ));
        let at = stamp(now);
        let file = EpicFile {
            format_version: layout::FORMAT_VERSION,
            id: id.clone(),
            name,
            color,
            is_draft: new.is_draft,
            attachments: Vec::new(),
            created_at: at,
            updated_at: at,
        };
        let result = (|| -> Result<(), AgboardError> {
            fs::create_dir(&temp).map_err(|e| io::write_error(&label, e))?;
            save_epic(shared, &temp, &file)?;
            io::write_atomic(
                &layout::epic_document(&temp),
                document.as_bytes(),
                &document_label,
            )?;
            fs::rename(&temp, &target).map_err(|e| io::write_error(&label, e))?;
            io::sync_dir(&epics).map_err(|e| io::write_error(&label, e))
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&temp);
            return Err(error);
        }
        epic_view(shared, project, &id)
    }

    /// Read one epic with its document.
    pub fn epic(&self, project: &ProjectId, id: &EpicId) -> Result<EpicView, AgboardError> {
        // The lock also finishes the one-time move to EPIC.md before the read.
        let (_dir, _lock) = lock_project(self.shared_dir(), project)?;
        epic_view(self.shared_dir(), project, id)
    }

    /// Change an epic's name, color, draft flag, and/or document. The document is
    /// checked before anything is written; EPIC.md is saved before epic.json.
    /// A value that does not change writes nothing.
    pub fn update_epic(
        &self,
        project: &ProjectId,
        id: &EpicId,
        update: EpicUpdate,
        now: DateTime<Utc>,
    ) -> Result<Changed<EpicView>, AgboardError> {
        let name = update
            .name
            .as_deref()
            .map(validate::validate_epic_name)
            .transpose()?;
        let color = update
            .color
            .as_deref()
            .map(validate::normalize_color)
            .transpose()?;
        let document = update
            .document
            .as_deref()
            .map(validate::normalize_document)
            .transpose()?;
        let shared = self.shared_dir();
        let (_project_dir, _lock) = lock_project(shared, project)?;
        let (dir, mut file) = read_epic_file(shared, project, id)?;

        let mut changed = false;
        if let Some(name) = name
            && name != file.name
        {
            file.name = name;
            changed = true;
        }
        if let Some(color) = color
            && color != file.color
        {
            file.color = color;
            changed = true;
        }
        if let Some(is_draft) = update.is_draft
            && is_draft != file.is_draft
        {
            file.is_draft = is_draft;
            changed = true;
        }
        let current_document = read_document(shared, &dir)?;
        let next_document = document.unwrap_or_else(|| current_document.clone());
        let document_changed = next_document != current_document;
        if document_changed {
            let label = layout::shared_label(shared, &layout::epic_document(&dir));
            validate::ensure_document_body(&next_document, &label)?;
            save_document(shared, &dir, &next_document)?;
            changed = true;
        }
        if changed {
            file.updated_at = stamp(now);
            save_epic(shared, &dir, &file)?;
        }
        Ok(Changed {
            value: view_of(file, next_document),
            changed,
        })
    }

    /// Replace an epic's task order, the `priority` list of its EPIC.md. The
    /// list is checked first (positive IDs, no repeats). IDs that no task of
    /// the epic holds any more are dropped, so the stored order is the order of
    /// the tasks that exist. Other frontmatter keys and the body stay. A list
    /// that does not change writes nothing.
    pub fn set_epic_priority(
        &self,
        project: &ProjectId,
        id: &EpicId,
        priority: &[i64],
        now: DateTime<Utc>,
    ) -> Result<Changed<EpicView>, AgboardError> {
        frontmatter::validate_priority(priority).map_err(|d| AgboardError::InvalidValue {
            field: d.field,
            reason: d.reason,
        })?;
        let shared = self.shared_dir();
        let (_project_dir, _lock) = lock_project(shared, project)?;
        let (dir, mut file) = read_epic_file(shared, project, id)?;
        let members: Vec<i64> = reader::read_snapshot_locked(shared, project)?
            .tasks
            .iter()
            .filter(|task| task.epic_id.as_deref() == Some(id.as_str()))
            .map(|task| task.id)
            .collect();
        let kept: Vec<i64> = priority
            .iter()
            .copied()
            .filter(|task| members.contains(task))
            .collect();

        let current_document = read_document(shared, &dir)?;
        let document_label = layout::shared_label(shared, &layout::epic_document(&dir));
        let next_document =
            frontmatter::compose_priority(&current_document, &kept).map_err(|d| {
                AgboardError::FileInvalid {
                    file: document_label.clone(),
                    field: d.field,
                    reason: d.reason,
                }
            })?;
        let changed = next_document != current_document;
        if changed {
            validate::ensure_document_body(&next_document, &document_label)?;
            save_document(shared, &dir, &next_document)?;
            file.updated_at = stamp(now);
            save_epic(shared, &dir, &file)?;
        }
        Ok(Changed {
            value: view_of(file, next_document),
            changed,
        })
    }
}
