//! Reading questions together with the tasks that refer to them.

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{QaRequestFile, QuestionView, read_request};
use crate::file_store::reader;

impl FileStore {
    /// Every question of the project, in ID order, with the tasks that refer to it.
    pub fn questions(&self, project: &ProjectId) -> Result<Vec<QuestionView>, AgboardError> {
        Ok(self.snapshot(project)?.questions)
    }

    /// One question. A question that is not found while a request file is broken reports
    /// the broken file.
    pub fn question(&self, project: &ProjectId, id: &str) -> Result<QuestionView, AgboardError> {
        let snapshot = self.snapshot(project)?;
        if let Some(view) = snapshot.questions.into_iter().find(|q| q.id == id) {
            return Ok(view);
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
            None => AgboardError::QuestionNotFound { id: id.to_owned() },
        })
    }

    /// One request and its questions.
    pub fn request(
        &self,
        project: &ProjectId,
        request_id: &str,
    ) -> Result<(QaRequestFile, Vec<QuestionView>), AgboardError> {
        let project_dir = reader::project_dir_checked(self.shared_dir(), project)?;
        let file = read_request(self.shared_dir(), &project_dir, request_id)?;
        let questions = self
            .questions(project)?
            .into_iter()
            .filter(|q| q.request_id == request_id)
            .collect();
        Ok((file, questions))
    }
}
