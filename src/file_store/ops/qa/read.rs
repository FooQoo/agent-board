//! Reading messages together with the tasks that refer to them.

use std::path::Path;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{MessageView, QuestionView, RequestView};
use crate::file_store::reader;

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
}
