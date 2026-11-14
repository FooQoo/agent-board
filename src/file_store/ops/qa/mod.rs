//! Writes of project QA: asking, answering, withdrawing, and the task references.
//!
//! Each write takes the project lock, reads the latest request files and tasks, and saves the
//! request files and the TASK.md pairs it changes as one batch, so either every file changes
//! or none does. The readable record goes to the history of the tasks that refer to a question.

mod answer;
mod ask;
mod link;
mod read;
mod withdraw;

pub use answer::AnswerItem;
pub use ask::{AskInput, AskQuestion};

use std::path::Path;

use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::io;
use crate::file_store::model::{Choice, TaskFile};
use crate::file_store::qa::{self, QaIndex, QaRequestFile};
use crate::file_store::transaction::FileChange;
use crate::file_store::{layout, reader};

/// The bytes of a request file as it is stored.
fn request_bytes(file: &QaRequestFile) -> Result<Vec<u8>, AgboardError> {
    let mut bytes = serde_json::to_vec_pretty(file)
        .map_err(|e| io::write_error(&format!("qa/{}/request.json", file.request_id), e))?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// The change that writes `file`, from the bytes it has now (`None` when it is new).
fn request_change(
    project_dir: &Path,
    file: &QaRequestFile,
    is_new: bool,
) -> Result<FileChange, AgboardError> {
    let target = qa::request_relative(&file.request_id);
    let old = if is_new {
        None
    } else {
        let path = project_dir.join(&target);
        Some(io::read_bytes(&path, &target.to_string_lossy())?)
    };
    Ok(FileChange {
        target,
        old,
        new: Some(request_bytes(file)?),
    })
}

/// A choice list as one history line: `id: label; id: label`.
fn options_line(choices: &[Choice]) -> String {
    choices
        .iter()
        .map(|choice| format!("{}: {}", choice.id, choice.label))
        .collect::<Vec<_>>()
        .join("; ")
}

/// A task that refers to questions, with its TASK.md text.
struct Referrer {
    task: TaskFile,
    text: String,
    questions: Vec<String>,
}

/// Every readable task whose `questions` name one of `ids`. A task that cannot be read is
/// left out: its record cannot be written, and the answer does not depend on it.
fn referrers(
    shared: &Path,
    project: &ProjectId,
    project_dir: &Path,
    ids: &[String],
) -> Result<Vec<Referrer>, AgboardError> {
    let mut found = Vec::new();
    for task_id in reader::task_ids(project_dir)? {
        let Ok(task) = reader::read_task_strict(shared, project, task_id) else {
            continue;
        };
        let Ok(text) = reader::read_body(shared, project, task_id) else {
            continue;
        };
        let parsed = parse_task(&text, ParseMode::Stored);
        if !parsed.history_defects.is_empty() {
            continue;
        }
        if parsed.questions.iter().any(|q| ids.contains(q)) {
            found.push(Referrer {
                questions: parsed.questions,
                task,
                text,
            });
        }
    }
    Ok(found)
}

/// Whether the task waits for a person, read from the latest files under the lock.
pub(in crate::file_store) fn task_waits(
    shared: &Path,
    project: &ProjectId,
    task_id: i64,
) -> Result<bool, AgboardError> {
    let project_dir = layout::project_dir(shared, project);
    let text = reader::read_body(shared, project, task_id)?;
    let (ids, error) = match crate::file_store::frontmatter::questions_of(&text) {
        Ok(ids) => (ids, false),
        Err(_) => (Vec::new(), true),
    };
    if ids.is_empty() && !error {
        return Ok(false);
    }
    Ok(QaIndex::load(shared, &project_dir)?.is_waiting(&ids, error))
}

/// The defect of a broken request file, as the error a write reports.
fn broken_file_error(index: &QaIndex) -> Option<AgboardError> {
    index.problems.first().map(|p| AgboardError::FileInvalid {
        file: p.file.clone(),
        field: p.field.clone(),
        reason: p.reason.clone(),
    })
}
