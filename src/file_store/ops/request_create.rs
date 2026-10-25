//! Atomic creation for the simple-request API, including images.

use std::fs;

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::history::{ParseMode, compose_task, parse_task};
use super::super::model::SimpleRequestInput;
use super::super::{io, layout, model, reader, validate};
use super::{
    HistoryKind, Transition, lane_end, lock_project, save_project, stamp, transition_event,
};
use crate::domain::{Attachment, Column, ProjectId, RunState, validate_attachment, validate_title};
use crate::error::AgboardError;

impl FileStore {
    /// Create a simple AI task and publish its complete directory with one
    /// same-filesystem rename. Each accepted submission creates a new task.
    pub fn create_simple_request(
        &self,
        project: &ProjectId,
        request: SimpleRequestInput,
        now: DateTime<Utc>,
    ) -> Result<model::TaskView, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let title = validate_title(&request.title)?;
        let body = request.body.replace("\r\n", "\n");
        let normalized_body = crate::domain::normalize_and_validate_description(
            &crate::file_store::frontmatter::parse(&body).body,
        )?;
        let epic = request
            .epic_id
            .as_deref()
            .map(str::parse::<validate::EpicId>)
            .transpose()?;
        if let Some(epic) = &epic {
            super::epic::read_epic_file(shared, project, epic)?;
        }

        let mut attachments = Vec::with_capacity(request.images.len());
        let mut total_bytes = 0usize;
        let mut seen_ids = std::collections::HashSet::new();
        for image in &request.images {
            if !seen_ids.insert(&image.id) {
                return Err(AgboardError::InvalidValue {
                    field: "attachmentId".into(),
                    reason: "Attachment IDs must be unique.".into(),
                });
            }
            let media_type = validate_attachment(&image.id, &image.name, &image.bytes)?;
            total_bytes = total_bytes.saturating_add(image.bytes.len());
            if total_bytes > crate::domain::MAX_TASK_ATTACHMENT_BYTES {
                return Err(AgboardError::AttachmentLimitExceeded);
            }
            attachments.push((
                media_type.to_string(),
                image
                    .name
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(&image.name)
                    .to_string(),
            ));
        }
        if request.images.len() > crate::domain::MAX_TASK_ATTACHMENTS {
            return Err(AgboardError::AttachmentLimitExceeded);
        }

        let mut project_file = reader::read_project_file(shared, project)?;
        let id = project_file.next_task_id;
        project_file.next_task_id = id
            .checked_add(1)
            .ok_or_else(|| io::write_error("project.json", "The task number overflowed."))?;
        // Reserving before the staged write intentionally permits gaps after
        // failures and prevents reuse across concurrent requests.
        save_project(shared, &project_dir, &project_file)?;

        let at = stamp(now);
        let position = lane_end(shared, project, Column::Todo)?;
        let mut stored_attachments = Vec::with_capacity(request.images.len());
        for (image, (media_type, name)) in request.images.iter().zip(&attachments) {
            stored_attachments.push(Attachment {
                id: image.id.clone(),
                name: name.clone(),
                media_type: media_type.clone(),
                size: image.bytes.len() as i64,
                created_at: at,
            });
        }
        let language = self.history_language.unwrap_or_else(|| {
            super::super::history_language::HistoryLanguage::infer(&normalized_body, &title)
        });
        let task = model::TaskFile {
            format_version: layout::FORMAT_VERSION,
            id,
            title,
            assignee: crate::domain::Assignee::Ai,
            epic_id: epic.map(|value| value.to_string()),
            task_status: Column::Todo,
            agent_status: RunState::Idle,
            position,
            is_draft: false,
            archived_at: None,
            pending_request_id: None,
            pending_request: None,
            request_answers: Vec::new(),
            created_at: at,
            updated_at: at,
            agent_status_changed_at: at,
            task_status_changed_at: at,
            attachments: stored_attachments,
            // `simpleRequest` remains readable for compatibility with records
            // created by older versions, but new tasks no longer store it.
            simple_request: None,
            onboarding_sample: None,
            history: vec![transition_event(Transition {
                language,
                kind: HistoryKind::Created,
                reason: None,
                from_task: None,
                to_task: Column::Todo,
                from_agent: None,
                to_agent: RunState::Idle,
                at,
            })?],
        };
        let full_body = format!("## 元の依頼\n\n{}", normalized_body.trim_end());
        let parsed = parse_task(&full_body, ParseMode::NewInput);
        let markdown =
            compose_task(&full_body, &parsed.body, None, &task.history).map_err(|defect| {
                AgboardError::FileInvalid {
                    file: format!("tasks/{id}/TASK.md"),
                    field: defect.field,
                    reason: defect.reason,
                }
            })?;

        let staging_root = project_dir.join(".internal").join("request-staging");
        if layout::has_symlink_below(&project_dir, &staging_root)
            .map_err(|e| io::write_error("request-staging", e))?
            || layout::has_symlink_below(&project_dir, &layout::task_dir(&project_dir, id))
                .map_err(|e| io::write_error("task", e))?
        {
            return Err(io::write_error(
                "request-staging",
                "a symbolic link is in the way",
            ));
        }
        fs::create_dir_all(&staging_root).map_err(|e| io::write_error("request-staging", e))?;
        let staging = staging_root
            .join(io::random_hex(16).map_err(|e| io::write_error("request-staging", e))?);
        fs::create_dir(&staging).map_err(|e| io::write_error("request-staging", e))?;
        let result = (|| -> Result<(), AgboardError> {
            io::write_json(
                &layout::task_json(&staging),
                &model::TaskMetadata::from(&task),
                "task.json",
            )?;
            io::write_atomic(&layout::task_md(&staging), markdown.as_bytes(), "TASK.md")?;
            if !request.images.is_empty() {
                let assets = layout::assets_dir(&staging);
                fs::create_dir(&assets).map_err(|e| io::write_error("assets", e))?;
                for (image, (media_type, _)) in request.images.iter().zip(&attachments) {
                    let ext = layout::asset_extension(media_type)
                        .ok_or_else(|| io::write_error("assets", "unsupported image type"))?;
                    let path = assets.join(format!("{}.{}", image.id, ext));
                    io::write_atomic(&path, &image.bytes, "assets")?;
                }
            }
            let target = layout::task_dir(&project_dir, id);
            fs::rename(&staging, &target).map_err(|e| io::write_error("task", e))?;
            io::sync_dir(&layout::tasks_dir(&project_dir))
                .map_err(|e| io::write_error("tasks", e))?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        reader::read_task_locked(shared, project, id)
    }
}
