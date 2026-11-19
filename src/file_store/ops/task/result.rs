//! Recording the results delivered to the requester.
//!
//! A result is a short summary, optionally with images and a link, stored in
//! the task's `task.json` as one entry of `results`. Recording one is a work
//! note: it changes neither the lane nor the run state, and the agent goes on.
//!
//! The entry's `key` makes a retry safe. The key is given with `--key` or, by
//! default, derived from the content (kind, summary, link, and the images'
//! bytes in order), so a retry of the same delivery finds the entry that exists and
//! changes nothing. A save that fails writes no entry and leaves no image file.

use std::fs;

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};

use super::super::super::FileStore;
use super::super::super::layout;
use super::super::super::model::{HistoryRecord, TaskView};
use super::super::super::reader;
use super::super::attachment::write_image;
use super::super::{ensure_ai_task_not_done, lock_project, save_task, stamp};
use super::view;
use crate::domain::{Attachment, AttachmentInput, Draft, ProjectId, ResultKind, TaskResult};
use crate::error::AgboardError;

/// The most results one task keeps.
pub const MAX_RESULTS: usize = 100;
/// The longest summary or link, in characters.
pub const MAX_RESULT_TEXT_CHARS: usize = 2_000;
/// The longest explicit key, in characters.
pub const MAX_RESULT_KEY_CHARS: usize = 64;
/// The most images one result holds.
pub const MAX_RESULT_IMAGES: usize = 20;

/// What the agent delivers.
#[derive(Debug, Clone)]
pub struct ResultInput {
    pub kind: ResultKind,
    pub summary: String,
    pub link: Option<String>,
    /// The images to attach in order, each with a new attachment ID.
    pub images: Vec<AttachmentInput>,
    /// An explicit key for retries; `None` derives it from the content.
    pub key: Option<String>,
}

/// The outcome of recording a result.
#[derive(Debug, Clone)]
pub struct RecordedResult {
    pub result: TaskResult,
    /// The images of the result in order; empty when it has none.
    pub attachments: Vec<Attachment>,
    /// `false` when the key already existed and nothing was written.
    pub created: bool,
    pub task: TaskView,
}

fn invalid(field: &str, reason: &str) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.into(),
        reason: reason.into(),
    }
}

fn clean_text(field: &str, value: &str) -> Result<String, AgboardError> {
    let text = value.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim();
    let count = text.chars().count();
    if count == 0 || count > MAX_RESULT_TEXT_CHARS {
        return Err(invalid(
            field,
            &format!("A {field} must be 1 to {MAX_RESULT_TEXT_CHARS} characters."),
        ));
    }
    Ok(text.to_owned())
}

fn clean_link(value: &str) -> Result<String, AgboardError> {
    let link = clean_text("link", value)?;
    if link.chars().any(char::is_control) {
        return Err(invalid("link", "A link must be on one line."));
    }
    Ok(link)
}

fn clean_key(value: &str) -> Result<String, AgboardError> {
    let key = value.trim();
    let valid = !key.is_empty()
        && key.chars().count() <= MAX_RESULT_KEY_CHARS
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'));
    if !valid {
        return Err(invalid(
            "key",
            "A key must be 1 to 64 characters of letters, digits, '.', '_', ':' and '-'.",
        ));
    }
    Ok(key.to_owned())
}

/// 32 lowercase hex digits taken from the content of a delivery.
fn content_key(
    kind: ResultKind,
    summary: &str,
    link: Option<&str>,
    images: &[AttachmentInput],
) -> String {
    let mut hash = Sha256::new();
    hash.update(kind.as_str().as_bytes());
    for part in [Some(summary), link] {
        hash.update([0]);
        hash.update(part.unwrap_or("").as_bytes());
    }
    for image in images {
        hash.update([0]);
        hash.update(Sha256::digest(&image.bytes));
    }
    hash.finalize()[..16]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The first line of the summary, cut to a length a history entry can carry.
fn excerpt(summary: &str) -> String {
    let line = summary.lines().next().unwrap_or("").trim();
    if line.chars().count() > 200 {
        let cut: String = line.chars().take(199).collect();
        format!("{cut}…")
    } else {
        line.to_owned()
    }
}

impl FileStore {
    /// Record a result on a task, from the agent side (the CLI). A task that is
    /// archived, a draft, or Done refuses it, as for any agent change, except
    /// that a retry of a result that was already recorded succeeds quietly.
    pub fn add_result(
        &self,
        project: &ProjectId,
        id: i64,
        input: ResultInput,
        now: DateTime<Utc>,
    ) -> Result<RecordedResult, AgboardError> {
        let summary = clean_text("summary", &input.summary)?;
        let link = input.link.as_deref().map(clean_link).transpose()?;
        if input.images.len() > MAX_RESULT_IMAGES {
            return Err(invalid(
                "file",
                &format!("A result holds at most {MAX_RESULT_IMAGES} images."),
            ));
        }
        let key = match input.key.as_deref() {
            Some(key) => clean_key(key)?,
            None => content_key(input.kind, &summary, link.as_deref(), &input.images),
        };

        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;

        if let Some(existing) = task.results.iter().find(|r| r.key == key) {
            let stored = existing.image_ids();
            let same_image = stored.len() == input.images.len()
                && stored
                    .iter()
                    .zip(&input.images)
                    .all(|(attachment_id, image)| {
                        task.attachments
                            .iter()
                            .find(|a| a.id == *attachment_id)
                            .and_then(|a| {
                                let ext = layout::asset_extension(&a.media_type)?;
                                let path =
                                    layout::task_asset_path(&project_dir, id, &a.id, ext).ok()?;
                                fs::read(path).ok()
                            })
                            .is_some_and(|bytes| {
                                Sha256::digest(&bytes) == Sha256::digest(&image.bytes)
                            })
                    });
            if existing.kind != input.kind
                || existing.summary != summary
                || existing.link != link
                || !same_image
            {
                return Err(invalid("key", "This key was used for a different result."));
            }
            let attachments = existing
                .image_ids()
                .iter()
                .filter_map(|a| task.attachments.iter().find(|x| x.id == *a))
                .cloned()
                .collect();
            return Ok(RecordedResult {
                result: existing.clone(),
                attachments,
                created: false,
                task: view(shared, project, id)?,
            });
        }

        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        ensure_ai_task_not_done(&task, crate::domain::Actor::Ai)?;
        if task.draft == Some(Draft::Human) {
            return Err(AgboardError::TaskIsDraft { id });
        }
        if task.results.len() >= MAX_RESULTS {
            return Err(invalid(
                "results",
                &format!("A task keeps at most {MAX_RESULTS} results."),
            ));
        }

        let at = stamp(now);
        let language = self.history_language(project, &task)?;
        let mut written = Vec::new();
        let mut attachments = Vec::new();
        let owner = super::super::super::model::AttachmentOwner::Task(id);
        for image in &input.images {
            match write_image(shared, &project_dir, &owner, &task.attachments, image, at) {
                Ok((metadata, path)) => {
                    task.attachments.push(metadata.clone());
                    attachments.push(metadata);
                    written.push(path);
                }
                Err(error) => {
                    for path in written {
                        let _ = fs::remove_file(path);
                    }
                    return Err(error);
                }
            }
        }

        let version = task.results.iter().map(|r| r.version).max().unwrap_or(0) + 1;
        let result = TaskResult {
            version,
            key,
            kind: input.kind,
            summary,
            attachment_id: None,
            attachment_ids: Vec::new(),
            link,
            at,
        }
        .with_images(attachments.iter().map(|a| a.id.clone()).collect());
        let note = excerpt(&result.summary);
        let (english_kind, japanese_kind) = match result.kind {
            ResultKind::Progress => ("progress", "途中"),
            ResultKind::Final => ("final", "最終"),
        };
        let reason = language
            .text(
                &format!("Recorded {english_kind} result v{version}: {note}"),
                &format!("成果 v{version}（{japanese_kind}）を記録しました: {note}"),
            )
            .to_owned();
        task.results.push(result.clone());
        task.history.push(HistoryRecord { at, reason });
        task.updated_at = at;
        if let Err(error) = save_task(shared, &project_dir, &task) {
            for path in written {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
        Ok(RecordedResult {
            result,
            attachments,
            created: true,
            task: view(shared, project, id)?,
        })
    }
}
