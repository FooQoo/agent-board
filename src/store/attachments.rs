use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};

use super::{
    projects::{ProjectStore, bump_project, require_project},
    rows::load_card,
};
use crate::{
    clock::format_utc,
    domain::{
        Attachment, AttachmentData, AttachmentInput, Card, MAX_CARD_ATTACHMENT_BYTES,
        MAX_CARD_ATTACHMENTS, ProjectId, validate_attachment,
    },
    error::SkanError,
};

fn digest(
    operation: &str,
    card_id: i64,
    additions: &[AttachmentInput],
    removals: &[String],
    title: Option<&str>,
    description: Option<&str>,
) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(operation.as_bytes());
    h.update(card_id.to_le_bytes());
    for a in additions {
        h.update(a.id.as_bytes());
        h.update(a.name.as_bytes());
        h.update(&a.bytes);
    }
    for id in removals {
        h.update(id.as_bytes());
    }
    if let Some(v) = title {
        h.update(v.as_bytes());
    }
    if let Some(v) = description {
        h.update(v.as_bytes());
    }
    h.finalize().to_vec()
}

fn check_limits(
    conn: &rusqlite::Connection,
    project: &ProjectId,
    card_id: i64,
    adding: usize,
    added_bytes: usize,
    removing: usize,
    removed_bytes: usize,
) -> Result<(), SkanError> {
    let (count, total): (i64, i64) = conn.query_row("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM attachments WHERE project_id = ?1 AND card_id = ?2", params![project.as_str(), card_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let count = count as usize;
    let total = total as usize;
    let remaining_count = count.saturating_sub(removing);
    let remaining_total = total.saturating_sub(removed_bytes);
    if remaining_count + adding > MAX_CARD_ATTACHMENTS
        || remaining_total + added_bytes > MAX_CARD_ATTACHMENT_BYTES
    {
        return Err(SkanError::AttachmentLimitExceeded);
    }
    Ok(())
}

impl ProjectStore {
    /// Return the result of an identical multipart save, if it was recorded.
    /// This is used before creating a card so a lost HTTP response can be
    /// retried without creating a second card.
    pub fn replay_attachment_request(
        &self,
        project: &ProjectId,
        request_id: &str,
        additions: &[AttachmentInput],
    ) -> Result<Option<Card>, SkanError> {
        self.read(|conn| {
            require_project(conn, project)?;
            let Some((card_id, expected)) = conn
                .query_row(
                    "SELECT card_id, digest FROM attachment_requests WHERE project_id = ?1 AND request_id = ?2",
                    params![project.as_str(), request_id],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)),
                )
                .optional()?
            else {
                return Ok(None);
            };
            let actual = digest("save", card_id, additions, &[], None, None);
            if actual != expected {
                return Err(SkanError::AttachmentRequestConflict);
            }
            Ok(Some(load_card(conn, project, card_id)?))
        })
    }

    pub fn attachment_data_for_card(
        &self,
        project: &ProjectId,
        card_id: i64,
        id: &str,
    ) -> Result<AttachmentData, SkanError> {
        self.attachment(project, card_id, id)
    }
    pub fn attachments(
        &self,
        project: &ProjectId,
        card_id: i64,
    ) -> Result<Vec<Attachment>, SkanError> {
        self.read(|conn| {
            require_project(conn, project)?;
            load_card(conn, project, card_id).map(|c| c.attachments)
        })
    }

    pub fn attachment(
        &self,
        project: &ProjectId,
        card_id: i64,
        id: &str,
    ) -> Result<AttachmentData, SkanError> {
        self.read(|conn| { require_project(conn, project)?; load_card(conn, project, card_id)?; let row = conn.query_row("SELECT id, name, media_type, size, created_at, bytes FROM attachments WHERE project_id = ?1 AND card_id = ?2 AND id = ?3", params![project.as_str(), card_id, id], |r| { let t: String = r.get(4)?; Ok(AttachmentData { metadata: Attachment { id: r.get(0)?, name: r.get(1)?, media_type: r.get(2)?, size: r.get(3)?, created_at: crate::clock::parse_utc(&t).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))? }, bytes: r.get(5)? }) }).optional()?; row.ok_or_else(|| SkanError::AttachmentNotFound { id: id.to_owned() }) })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_card_attachments(
        &self,
        project: &ProjectId,
        card_id: i64,
        title: Option<&str>,
        description: Option<&str>,
        additions: &[AttachmentInput],
        removals: &[String],
        request_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        let digest = digest("save", card_id, additions, removals, title, description);
        self.write(|conn| {
            require_project(conn, project)?; let card = load_card(conn, project, card_id)?;
            if card.is_draft { return Err(SkanError::CardIsDraft { id: card_id }); }
            if let Some(existing) = conn.query_row("SELECT digest FROM attachment_requests WHERE project_id = ?1 AND request_id = ?2", params![project.as_str(), request_id], |r| r.get::<_, Vec<u8>>(0)).optional()? { if existing == digest { return load_card(conn, project, card_id); } return Err(SkanError::AttachmentRequestConflict); }
            let mut added_bytes = 0usize; for item in additions { let media = validate_attachment(&item.id, &item.name, &item.bytes)?; added_bytes += item.bytes.len(); if additions.iter().filter(|a| a.id == item.id).count() > 1 { return Err(SkanError::InvalidValue { field: "attachmentId".into(), reason: "Attachment IDs must be unique.".into() }); } let _ = media; }
            let removed_bytes: usize = removals.iter().map(|id| conn.query_row("SELECT size FROM attachments WHERE project_id = ?1 AND card_id = ?2 AND id = ?3", params![project.as_str(), card_id, id], |r| r.get::<_, i64>(0)).optional().ok().flatten().unwrap_or(0).max(0) as usize).sum();
            check_limits(conn, project, card_id, additions.len(), added_bytes, removals.len(), removed_bytes)?;
            let mut changed = false;
            for id in removals { let n = conn.execute("DELETE FROM attachments WHERE project_id = ?1 AND card_id = ?2 AND id = ?3", params![project.as_str(), card_id, id])?; if n == 0 { return Err(SkanError::AttachmentNotFound { id: id.clone() }); } changed = true; }
            for item in additions { let media = validate_attachment(&item.id, &item.name, &item.bytes)?; conn.execute("INSERT INTO attachments (project_id, card_id, id, name, media_type, size, created_at, bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![project.as_str(), card_id, item.id, item.name.rsplit(['/', '\\']).next().unwrap_or(&item.name), media, item.bytes.len() as i64, format_utc(now), item.bytes])?; changed = true; }
            let next_title = title.unwrap_or(&card.title); let next_description = description.unwrap_or(&card.description); let text_changed = next_title != card.title || next_description != card.description;
            if text_changed { conn.execute("UPDATE cards SET title = ?1, description = ?2, updated_at = ?3 WHERE project_id = ?4 AND id = ?5", params![next_title, next_description, format_utc(now), project.as_str(), card_id])?; changed = true; }
            if changed { bump_project(conn, project)?; }
            conn.execute("INSERT INTO attachment_requests (project_id, request_id, card_id, operation, digest, result_id) VALUES (?1, ?2, ?3, 'save', ?4, ?5)", params![project.as_str(), request_id, card_id, digest, card_id.to_string()])?;
            load_card(conn, project, card_id)
        })
    }

    pub fn add_attachment(
        &self,
        project: &ProjectId,
        card_id: i64,
        input: AttachmentInput,
        request_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        self.save_card_attachments(project, card_id, None, None, &[input], &[], request_id, now)
    }

    pub fn delete_attachment(
        &self,
        project: &ProjectId,
        card_id: i64,
        attachment_id: &str,
        request_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Card, SkanError> {
        self.save_card_attachments(
            project,
            card_id,
            None,
            None,
            &[],
            &[attachment_id.to_owned()],
            request_id,
            now,
        )
    }
}
