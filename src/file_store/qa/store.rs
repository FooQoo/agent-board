//! Where the requests live and how they are read.
//!
//! `qa/<request-id>/request.json` holds one request. A folder whose name is not a request ID
//! (a staging folder starting with a dot, a stray file) is ignored. The lenient read keeps
//! going past a broken file and reports it; the strict read fails on it.

use std::fs;
use std::path::{Path, PathBuf};

use super::check::check_request;
use super::model::{QaQuestion, QaRequestFile, QuestionKind, question_number};
use crate::error::AgboardError;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::Problem;
use crate::file_store::reader::{parse_file, problem_of};
use crate::file_store::validate::is_hex32;

pub fn qa_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("qa")
}

pub fn request_dir(project_dir: &Path, request_id: &str) -> PathBuf {
    qa_dir(project_dir).join(request_id)
}

pub fn request_json(request_dir: &Path) -> PathBuf {
    request_dir.join("request.json")
}

/// The project-relative path of a request file, as journals and labels name it.
pub fn request_relative(request_id: &str) -> PathBuf {
    PathBuf::from(format!("qa/{request_id}/request.json"))
}

/// The request IDs of a project, in order.
pub fn request_ids(project_dir: &Path) -> Result<Vec<String>, AgboardError> {
    let dir = qa_dir(project_dir);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let label = layout::project_label(project_dir, &dir);
    let mut ids = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| io::read_error(&label, e))? {
        let entry = entry.map_err(|e| io::read_error(&label, e))?;
        if let Some(name) = entry.file_name().to_str()
            && is_hex32(name)
            && entry.path().is_dir()
        {
            ids.push(name.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}

fn read_checked(
    shared: &Path,
    project_dir: &Path,
    id: &str,
) -> Result<QaRequestFile, AgboardError> {
    let path = request_json(&request_dir(project_dir, id));
    let label = layout::shared_label(shared, &path);
    let bytes = io::read_bytes(&path, &label)?;
    let file: QaRequestFile = parse_file(&bytes, &label)?;
    if let Some(d) = check_request(&file, id).into_iter().next() {
        return Err(AgboardError::FileInvalid {
            file: label,
            field: d.field,
            reason: d.reason,
        });
    }
    Ok(file)
}

/// Read one request strictly. A request that does not exist is `request_not_found`.
pub fn read_request(
    shared: &Path,
    project_dir: &Path,
    request_id: &str,
) -> Result<QaRequestFile, AgboardError> {
    if !is_hex32(request_id) || !request_dir(project_dir, request_id).is_dir() {
        return Err(AgboardError::RequestNotFound {
            id: request_id.to_string(),
        });
    }
    read_checked(shared, project_dir, request_id)
}

/// Every readable request of a project, the defects of the others, and whether any was broken.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QaIndex {
    pub requests: Vec<QaRequestFile>,
    pub problems: Vec<Problem>,
    /// A request file could not be read, so a missing reference may name one of its questions.
    pub broken: bool,
}

impl QaIndex {
    /// Read every request of a project. Only a failure to list the folder is an error.
    pub fn load(shared: &Path, project_dir: &Path) -> Result<QaIndex, AgboardError> {
        let mut index = QaIndex::default();
        for id in request_ids(project_dir)? {
            match read_checked(shared, project_dir, &id) {
                Ok(file) => index.requests.push(file),
                Err(error) => {
                    index.broken = true;
                    index.problems.push(problem_of(error));
                }
            }
        }
        Ok(index)
    }

    /// The question with this ID and the request that holds it.
    pub fn find(&self, id: &str) -> Option<(&QaRequestFile, &QaQuestion)> {
        self.requests.iter().find_map(|request| {
            request
                .questions
                .iter()
                .find(|q| q.id == id)
                .map(|q| (request, q))
        })
    }

    pub fn request(&self, id: &str) -> Option<&QaRequestFile> {
        self.requests.iter().find(|r| r.request_id == id)
    }

    /// Whether a task with these references waits for a person: an open question, an
    /// approval that was not given, a plan question without an approval that was given, a
    /// reference that may name a broken file, or references that cannot be read.
    pub fn is_waiting(&self, question_ids: &[String], questions_error: bool) -> bool {
        if questions_error {
            return true;
        }
        let found: Vec<_> = question_ids.iter().map(|id| self.find(id)).collect();
        let blocked = found.iter().any(|entry| match entry {
            Some((request, question)) => {
                request.question_status(question) == super::QuestionStatus::Open
                    || question.is_rejected_approval()
            }
            None => self.broken,
        });
        let planned = found.iter().flatten().any(|(request, question)| {
            question.kind == QuestionKind::Plan
                && request.question_status(question) != super::QuestionStatus::Withdrawn
        });
        let approved = found
            .iter()
            .flatten()
            .any(|(_, question)| question.is_given_approval());
        blocked || (planned && !approved)
    }

    /// The open questions among these references, lowest number first.
    pub fn open_among(&self, question_ids: &[String]) -> Vec<(&QaRequestFile, &QaQuestion)> {
        let mut open: Vec<_> = question_ids
            .iter()
            .filter_map(|id| self.find(id))
            .filter(|(request, question)| {
                request.question_status(question) == super::QuestionStatus::Open
            })
            .collect();
        open.sort_by_key(|(_, q)| question_number(&q.id).unwrap_or(i64::MAX));
        open
    }
}
