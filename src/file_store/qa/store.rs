//! Where the messages live and how they are read.
//!
//! `qa/Q-<n>/QA.md` holds one message, `qa/Q-<n>/attachments/` its images. A folder whose
//! name is not `Q-<n>` (a staging folder starting with a dot, a stray file) is ignored. The
//! lenient read keeps going past a broken file and reports it; the strict read fails on it.

use std::fs;
use std::path::{Path, PathBuf};

use super::check::check_message;
use super::codec::parse_message;
use super::model::{Message, Question, Request, question_number};
use crate::error::AgboardError;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::Problem;
use crate::file_store::reader::problem_of;

pub fn qa_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("qa")
}

pub fn message_dir(project_dir: &Path, id: &str) -> PathBuf {
    qa_dir(project_dir).join(id)
}

pub fn message_file(message_dir: &Path) -> PathBuf {
    message_dir.join("QA.md")
}

pub fn attachments_dir(message_dir: &Path) -> PathBuf {
    message_dir.join("attachments")
}

/// The project-relative path of a message file, as journals and labels name it.
pub fn message_relative(id: &str) -> PathBuf {
    PathBuf::from(format!("qa/{id}/QA.md"))
}

/// The message IDs of a project in number order.
pub fn message_ids(project_dir: &Path) -> Result<Vec<String>, AgboardError> {
    let dir = qa_dir(project_dir);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let label = layout::project_label(project_dir, &dir);
    let mut ids = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| io::read_error(&label, e))? {
        let entry = entry.map_err(|e| io::read_error(&label, e))?;
        if let Some(name) = entry.file_name().to_str()
            && question_number(name).is_some()
            && entry.path().is_dir()
        {
            ids.push(name.to_string());
        }
    }
    ids.sort_by_key(|id| question_number(id));
    Ok(ids)
}

/// Read one message strictly. A message that does not exist is `message_not_found`.
pub fn read_message(shared: &Path, project_dir: &Path, id: &str) -> Result<Message, AgboardError> {
    let dir = message_dir(project_dir, id);
    if question_number(id).is_none() || !dir.is_dir() {
        return Err(AgboardError::MessageNotFound { id: id.to_string() });
    }
    let path = message_file(&dir);
    let label = layout::shared_label(shared, &path);
    if !path.is_file() {
        return Err(AgboardError::FileUnreadable {
            file: label,
            reason: "QA.md is missing.".into(),
        });
    }
    let text = io::read_text(&path, &label)?;
    let invalid = |d: crate::file_store::validate::Defect| AgboardError::FileInvalid {
        file: label.clone(),
        field: d.field,
        reason: d.reason,
    };
    let message = parse_message(id, &text).map_err(invalid)?;
    match check_message(&message, id) {
        Some(d) => Err(invalid(d)),
        None => Ok(message),
    }
}

/// Every readable message of a project, the defects of the others, and whether any was broken.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QaIndex {
    pub messages: Vec<Message>,
    pub problems: Vec<Problem>,
    /// A message file could not be read, so a missing reference may name one of its questions.
    pub broken: bool,
}

impl QaIndex {
    /// Read every message of a project. Only a failure to list the folder is an error.
    pub fn load(shared: &Path, project_dir: &Path) -> Result<QaIndex, AgboardError> {
        let mut index = QaIndex::default();
        for id in message_ids(project_dir)? {
            match read_message(shared, project_dir, &id) {
                Ok(message) => index.messages.push(message),
                Err(error) => {
                    index.broken = true;
                    index.problems.push(problem_of(error));
                }
            }
        }
        Ok(index)
    }

    pub fn find(&self, id: &str) -> Option<&Message> {
        self.messages.iter().find(|m| m.id() == id)
    }

    pub fn question(&self, id: &str) -> Option<&Question> {
        match self.find(id)? {
            Message::Question(q) => Some(q),
            Message::Request(_) => None,
        }
    }

    pub fn questions(&self) -> impl Iterator<Item = &Question> {
        self.messages.iter().filter_map(|m| match m {
            Message::Question(q) => Some(q),
            Message::Request(_) => None,
        })
    }

    pub fn requests(&self) -> impl Iterator<Item = &Request> {
        self.messages.iter().filter_map(|m| match m {
            Message::Request(r) => Some(r),
            Message::Question(_) => None,
        })
    }

    /// Whether a task with these references waits for a person: a question without a reply,
    /// a reference that may name a broken file, or references that cannot be read.
    pub fn is_waiting(&self, question_ids: &[String], questions_error: bool) -> bool {
        questions_error
            || question_ids.iter().any(|id| match self.find(id) {
                Some(Message::Question(q)) => q.state() == super::MessageState::Open,
                Some(Message::Request(_)) => false,
                None => self.broken,
            })
    }

    /// The questions without a reply among these references, lowest number first.
    pub fn open_among(&self, question_ids: &[String]) -> Vec<&Question> {
        let mut open: Vec<_> = question_ids
            .iter()
            .filter_map(|id| self.question(id))
            .filter(|q| q.state() == super::MessageState::Open)
            .collect();
        open.sort_by_key(|q| question_number(&q.id).unwrap_or(i64::MAX));
        open
    }
}
