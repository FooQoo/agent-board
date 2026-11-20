//! Sending a request: the text and its images are published as one folder.

use std::collections::HashSet;
use std::fs;

use chrono::{DateTime, Utc};

use super::super::{lock_project, save_project, stamp};
use crate::domain::{
    MAX_TASK_ATTACHMENT_BYTES, MAX_TASK_ATTACHMENTS, ProjectId, validate_attachment,
};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{
    self, MAX_REQUEST_CHARS, Message, Request, RequestView, check_message, render_message,
};
use crate::file_store::{io, layout, reader};

/// An image sent with a request. It is stored as `attachments/<name>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestImage {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct SendRequestInput {
    /// The Markdown text of the request.
    pub text: String,
    pub images: Vec<RequestImage>,
}

fn invalid(field: &str, reason: &str) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.into(),
        reason: reason.into(),
    }
}

/// The stored name of an image: its base name, plain ASCII, with the extension of its type.
fn stored_name(name: &str, extension: &str) -> Result<String, AgboardError> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let plain = !base.is_empty()
        && base.len() <= 100
        && !base.starts_with('.')
        && base
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !plain {
        return Err(invalid(
            "image",
            "Image names are 1 to 100 letters, digits, dots, underscores, or hyphens.",
        ));
    }
    let lower = base.to_ascii_lowercase();
    let known = |ext: &str| lower.ends_with(&format!(".{ext}"));
    let matches_type = known(extension) || (extension == "jpg" && known("jpeg"));
    Ok(if matches_type {
        base.to_owned()
    } else {
        format!("{base}.{extension}")
    })
}

/// Check the images of a request or a question and name each one as it is stored: PNG, JPEG,
/// WebP, or GIF, at most 20 images and 50 MiB in all, with unique names.
pub(super) fn checked_images(
    images: &[RequestImage],
) -> Result<Vec<(String, &Vec<u8>)>, AgboardError> {
    if images.len() > MAX_TASK_ATTACHMENTS {
        return Err(AgboardError::AttachmentLimitExceeded);
    }
    let mut total = 0usize;
    let mut names = HashSet::new();
    let mut files = Vec::new();
    for image in images {
        let media = validate_attachment(&"0".repeat(32), &image.name, &image.bytes)?;
        total = total.saturating_add(image.bytes.len());
        if total > MAX_TASK_ATTACHMENT_BYTES {
            return Err(AgboardError::AttachmentLimitExceeded);
        }
        let extension = layout::asset_extension(media).ok_or_else(|| {
            invalid(
                "image",
                "Only PNG, JPEG, WebP, and GIF images are accepted.",
            )
        })?;
        let name = stored_name(&image.name, extension)?;
        // Case-insensitive file systems would store two such names in one file.
        if !names.insert(name.to_ascii_lowercase()) {
            return Err(invalid(
                "image",
                "Image names must be unique, ignoring letter case.",
            ));
        }
        files.push((name, &image.bytes));
    }
    Ok(files)
}

/// Write the images of each question to a staging folder `<n>/` under `.internal/`, so the
/// images are complete before the question appears. Returns `None` when there are none.
pub(super) fn stage_images(
    project_dir: &std::path::Path,
    images: &[Vec<(String, &Vec<u8>)>],
) -> Result<Option<std::path::PathBuf>, AgboardError> {
    if images.iter().all(Vec::is_empty) {
        return Ok(None);
    }
    let root = project_dir.join(".internal").join("request-staging");
    if layout::has_symlink_below(project_dir, &root)
        .map_err(|e| io::write_error("request-staging", e))?
    {
        return Err(io::write_error(
            "request-staging",
            "a symbolic link is in the way",
        ));
    }
    fs::create_dir_all(&root).map_err(|e| io::write_error("request-staging", e))?;
    let staging = root.join(io::random_hex(16).map_err(|e| io::write_error("request-staging", e))?);
    fs::create_dir(&staging).map_err(|e| io::write_error("request-staging", e))?;
    let written = (|| -> Result<(), AgboardError> {
        for (index, files) in images.iter().enumerate() {
            if files.is_empty() {
                continue;
            }
            let dir = staging.join(index.to_string());
            fs::create_dir(&dir).map_err(|e| io::write_error("attachments", e))?;
            for (name, bytes) in files {
                io::write_atomic(&dir.join(name), bytes, "attachments")?;
            }
        }
        Ok(())
    })();
    if let Err(error) = written {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(Some(staging))
}

impl FileStore {
    /// Send a request. The next question number is reserved, then `qa/Q-<n>/` is published
    /// with one rename, so a request is never seen without its images.
    pub fn send_request(
        &self,
        project: &ProjectId,
        input: SendRequestInput,
        now: DateTime<Utc>,
    ) -> Result<RequestView, AgboardError> {
        let text = input.text.replace("\r\n", "\n");
        let text = text.trim();
        if text.is_empty() || text.chars().count() > MAX_REQUEST_CHARS {
            return Err(invalid("text", "A request is 1 to 20000 characters."));
        }
        let files = checked_images(&input.images)?;

        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut project_file = reader::read_project_file(shared, project)?;
        let number = project_file.next_question_id;
        project_file.next_question_id = number
            .checked_add(1)
            .ok_or_else(|| io::write_error("project.json", "The question number overflowed."))?;
        // Reserving before the staged write permits gaps after failures, as task numbers do.
        save_project(shared, &project_dir, &project_file)?;

        let id = format!("Q-{number}");
        let request = Request {
            id: id.clone(),
            body: text.to_owned(),
            accepted_at: None,
            withdrawn_at: None,
            created_at: stamp(now),
        };
        let message = Message::Request(request.clone());
        if let Some(d) = check_message(&message, &id) {
            return Err(invalid(&d.field, &d.reason));
        }
        let markdown = render_message(&message)
            .map_err(|d| io::write_error(&format!("qa/{id}/QA.md"), d.reason))?;

        let target = qa::message_dir(&project_dir, &id);
        let staging_root = project_dir.join(".internal").join("request-staging");
        if layout::has_symlink_below(&project_dir, &staging_root)
            .map_err(|e| io::write_error("request-staging", e))?
            || layout::has_symlink_below(&project_dir, &target)
                .map_err(|e| io::write_error("qa", e))?
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
            io::write_atomic(&qa::message_file(&staging), markdown.as_bytes(), "QA.md")?;
            if !files.is_empty() {
                let dir = qa::attachments_dir(&staging);
                fs::create_dir(&dir).map_err(|e| io::write_error("attachments", e))?;
                for (name, bytes) in &files {
                    io::write_atomic(&dir.join(name), bytes, "attachments")?;
                }
            }
            let qa_dir = qa::qa_dir(&project_dir);
            fs::create_dir_all(&qa_dir).map_err(|e| io::write_error("qa", e))?;
            fs::rename(&staging, &target).map_err(|e| io::write_error("qa", e))?;
            io::sync_dir(&qa_dir).map_err(|e| io::write_error("qa", e))?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        Ok(RequestView::of(&request))
    }
}
