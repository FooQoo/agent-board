//! Reading messages together with the tasks that refer to them.

use std::path::Path;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{MessageView, QuestionView, RequestView};
use crate::file_store::reader;
use crate::file_store::{io, layout, qa};

/// The questions and the requests of a project, read while its lock is held.
pub(super) fn views_locked(
    shared: &Path,
    project: &ProjectId,
) -> Result<(Vec<QuestionView>, Vec<RequestView>), AgboardError> {
    let snapshot = reader::read_snapshot_locked(shared, project)?;
    Ok((snapshot.questions, snapshot.requests))
}

impl FileStore {
    /// Every question of the project, in ID order, with the tasks that refer to it.
    pub fn questions(&self, project: &ProjectId) -> Result<Vec<QuestionView>, AgboardError> {
        Ok(self.snapshot(project)?.questions)
    }

    /// Every message of the project, in ID order.
    pub fn messages(&self, project: &ProjectId) -> Result<Vec<MessageView>, AgboardError> {
        let snapshot = self.snapshot(project)?;
        let mut all: Vec<MessageView> = snapshot
            .questions
            .into_iter()
            .map(MessageView::Question)
            .chain(snapshot.requests.into_iter().map(MessageView::Request))
            .collect();
        all.sort_by_key(MessageView::number);
        Ok(all)
    }

    /// One message. A message that is not found while a message file is broken reports the
    /// broken file.
    pub fn message(&self, project: &ProjectId, id: &str) -> Result<MessageView, AgboardError> {
        let snapshot = self.snapshot(project)?;
        if let Some(view) = snapshot.questions.into_iter().find(|q| q.id == id) {
            return Ok(MessageView::Question(view));
        }
        if let Some(view) = snapshot.requests.into_iter().find(|r| r.id == id) {
            return Ok(MessageView::Request(view));
        }
        let broken = snapshot
            .problems
            .into_iter()
            .find(|p| p.file.contains("/qa/") || p.file.starts_with("qa/"));
        Err(match broken {
            Some(p) => AgboardError::FileInvalid {
                file: p.file,
                field: p.field,
                reason: p.reason,
            },
            None => AgboardError::MessageNotFound { id: id.to_owned() },
        })
    }

    /// One question. A request is `message_type_mismatch`.
    pub fn question(&self, project: &ProjectId, id: &str) -> Result<QuestionView, AgboardError> {
        match self.message(project, id)? {
            MessageView::Question(view) => Ok(view),
            MessageView::Request(_) => Err(AgboardError::MessageTypeMismatch {
                id: id.to_owned(),
                expected: "question".into(),
            }),
        }
    }

    /// One request. A question is `message_type_mismatch`.
    pub fn request(&self, project: &ProjectId, id: &str) -> Result<RequestView, AgboardError> {
        match self.message(project, id)? {
            MessageView::Request(view) => Ok(view),
            MessageView::Question(_) => Err(AgboardError::MessageTypeMismatch {
                id: id.to_owned(),
                expected: "request".into(),
            }),
        }
    }

    /// The bytes and media type of an image sent with a message, read from
    /// `qa/<id>/attachments/<name>`. A name that is not a plain file name, a file that is not
    /// there, and a path through a symbolic link are `attachment_not_found`; an unknown
    /// message is `message_not_found`. The media type comes from the file's own bytes.
    pub fn message_attachment(
        &self,
        project: &ProjectId,
        id: &str,
        name: &str,
    ) -> Result<(String, Vec<u8>), AgboardError> {
        let shared = self.shared_dir();
        let project_dir = reader::project_dir_checked(shared, project)?;
        let dir = qa::message_dir(&project_dir, id);
        if qa::question_number(id).is_none() || !dir.is_dir() {
            return Err(AgboardError::MessageNotFound { id: id.to_owned() });
        }
        let not_found = || AgboardError::AttachmentNotFound {
            id: name.to_owned(),
        };
        let plain = !name.is_empty()
            && name.len() <= 100
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if !plain {
            return Err(not_found());
        }
        let path = qa::attachments_dir(&dir).join(name);
        let label = layout::shared_label(shared, &path);
        let linked = layout::has_symlink_below(&project_dir, &path)
            .map_err(|e| io::read_error(&label, e))?;
        if linked || !path.is_file() {
            return Err(not_found());
        }
        let bytes = io::read_bytes(&path, &label)?;
        let media_type = match image::guess_format(&bytes) {
            Ok(image::ImageFormat::Png) => "image/png",
            Ok(image::ImageFormat::Jpeg) => "image/jpeg",
            Ok(image::ImageFormat::WebP) => "image/webp",
            Ok(image::ImageFormat::Gif) => "image/gif",
            _ => return Err(not_found()),
        };
        Ok((media_type.to_owned(), bytes))
    }
}
