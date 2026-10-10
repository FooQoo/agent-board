//! Text evidence of a card: UTF-8 files under the card's `evidence/` folder,
//! recorded in `task.json`. Only the card that owns an evidence ID can read or
//! delete it. Reads are allowed for archived cards; changes are not.

use std::fs;

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::io;
use super::super::layout;
use super::super::model::{EvidenceData, EvidenceRecord};
use super::super::reader;
use super::attachment::last_part;
use super::{lock_project, new_id, save_task, stamp};
use crate::domain::{
    MAX_ATTACHMENT_BYTES, MAX_CARD_ATTACHMENT_BYTES, MAX_CARD_ATTACHMENTS, ProjectId,
};
use crate::error::SkanError;

const EVIDENCE_LIMIT_REASON: &str =
    "A card may contain at most 20 evidence files and 50 MiB of evidence in total.";

impl FileStore {
    /// Register a UTF-8 text evidence from the agent side (the CLI). A draft
    /// card refuses it with `card_is_draft`.
    pub fn add_evidence(
        &self,
        project: &ProjectId,
        card_id: i64,
        name: &str,
        bytes: &[u8],
        now: DateTime<Utc>,
    ) -> Result<EvidenceRecord, SkanError> {
        self.add_evidence_gated(project, card_id, name, bytes, now, true)
    }

    /// Register a UTF-8 text evidence from a person in the Web UI. A draft card accepts it.
    pub fn add_evidence_for_user(
        &self,
        project: &ProjectId,
        card_id: i64,
        name: &str,
        bytes: &[u8],
        now: DateTime<Utc>,
    ) -> Result<EvidenceRecord, SkanError> {
        self.add_evidence_gated(project, card_id, name, bytes, now, false)
    }

    /// Register a UTF-8 text evidence for a card and write it to `evidence/`.
    /// The limits follow the image limits: 10 MiB per file, 20 files, and
    /// 50 MiB in total per card. Images and evidence are counted separately.
    fn add_evidence_gated(
        &self,
        project: &ProjectId,
        card_id: i64,
        name: &str,
        bytes: &[u8],
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<EvidenceRecord, SkanError> {
        if bytes.is_empty() {
            return Err(SkanError::InvalidValue {
                field: "evidence".into(),
                reason: "Evidence must not be empty.".into(),
            });
        }
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(SkanError::InvalidValue {
                field: "evidence".into(),
                reason: "Evidence must be at most 10 MiB.".into(),
            });
        }
        if std::str::from_utf8(bytes).is_err() {
            return Err(SkanError::InvalidValue {
                field: "evidence".into(),
                reason: "Evidence must be UTF-8 text.".into(),
            });
        }
        let name = last_part(name);
        if name.is_empty() {
            return Err(SkanError::InvalidValue {
                field: "name".into(),
                reason: "Evidence names must not be empty.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, card_id)?;
        if task.archived_at.is_some() {
            return Err(SkanError::CardArchived { id: card_id });
        }
        if block_drafts && task.is_draft {
            return Err(SkanError::CardIsDraft { id: card_id });
        }
        let total: usize = task
            .evidence
            .iter()
            .map(|e| usize::try_from(e.size).unwrap_or(0))
            .sum();
        if task.evidence.len() + 1 > MAX_CARD_ATTACHMENTS
            || total.saturating_add(bytes.len()) > MAX_CARD_ATTACHMENT_BYTES
        {
            return Err(SkanError::InvalidValue {
                field: "evidence".into(),
                reason: EVIDENCE_LIMIT_REASON.into(),
            });
        }

        let id = new_id()?;
        let path = layout::evidence_path(&project_dir, card_id, &id)?;
        let label = layout::shared_label(shared, &path);
        if layout::has_symlink_below(&project_dir, &path).map_err(|e| io::write_error(&label, e))? {
            return Err(io::write_error(&label, "a symbolic link is in the way"));
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| io::write_error(&label, e))?;
        }
        io::write_atomic(&path, bytes, &label)?;

        let at = stamp(now);
        let record = EvidenceRecord {
            id,
            name,
            size: bytes.len() as i64,
            created_at: at,
        };
        task.evidence.push(record.clone());
        task.updated_at = at;
        if let Err(error) = save_task(shared, &project_dir, &task) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(record)
    }

    /// Read the bytes of a card's evidence. An ID that the card does not own
    /// is `evidence_not_found`, as is a file reached through a symbolic link.
    pub fn read_evidence(
        &self,
        project: &ProjectId,
        card_id: i64,
        evidence_id: &str,
    ) -> Result<EvidenceData, SkanError> {
        let shared = self.shared_dir();
        let project_dir = reader::project_dir_checked(shared, project)?;
        let task = reader::read_task_strict(shared, project, card_id)?;
        let record = task
            .evidence
            .iter()
            .find(|e| e.id == evidence_id)
            .cloned()
            .ok_or_else(|| SkanError::EvidenceNotFound {
                id: evidence_id.to_string(),
            })?;
        let path = layout::evidence_path(&project_dir, card_id, &record.id)?;
        let label = layout::shared_label(shared, &path);
        let linked = layout::has_symlink_below(&project_dir, &path)
            .map_err(|e| io::read_error(&label, e))?;
        if linked || !path.is_file() {
            return Err(SkanError::EvidenceNotFound {
                id: evidence_id.to_string(),
            });
        }
        let bytes = io::read_bytes(&path, &label)?;
        Ok(EvidenceData { record, bytes })
    }

    /// Remove a card's evidence from the agent side (the CLI). A draft card refuses it.
    pub fn delete_evidence(
        &self,
        project: &ProjectId,
        card_id: i64,
        evidence_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), SkanError> {
        self.delete_evidence_gated(project, card_id, evidence_id, now, true)
    }

    /// Remove a card's evidence from a person in the Web UI. A draft card accepts it.
    pub fn delete_evidence_for_user(
        &self,
        project: &ProjectId,
        card_id: i64,
        evidence_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), SkanError> {
        self.delete_evidence_gated(project, card_id, evidence_id, now, false)
    }

    /// Remove a card's evidence from `task.json` and delete its file. The JSON
    /// is saved first, so a file left by a failed removal is not referenced.
    fn delete_evidence_gated(
        &self,
        project: &ProjectId,
        card_id: i64,
        evidence_id: &str,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<(), SkanError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, card_id)?;
        if task.archived_at.is_some() {
            return Err(SkanError::CardArchived { id: card_id });
        }
        if block_drafts && task.is_draft {
            return Err(SkanError::CardIsDraft { id: card_id });
        }
        let index = task
            .evidence
            .iter()
            .position(|e| e.id == evidence_id)
            .ok_or_else(|| SkanError::EvidenceNotFound {
                id: evidence_id.to_string(),
            })?;
        let path = layout::evidence_path(&project_dir, card_id, evidence_id)?;
        let label = layout::shared_label(shared, &path);
        if layout::has_symlink_below(&project_dir, &path).map_err(|e| io::write_error(&label, e))? {
            return Err(io::write_error(&label, "a symbolic link is in the way"));
        }

        task.evidence.remove(index);
        task.updated_at = stamp(now);
        save_task(shared, &project_dir, &task)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io::write_error(&label, e)),
        }
    }
}
