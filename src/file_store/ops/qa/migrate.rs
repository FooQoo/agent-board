//! The one-time conversion of the old `qa/<request-id>/request.json` files.
//!
//! The first time a project is read or written, under its lock: every question that is still
//! open (not answered, and its request not withdrawn) becomes `qa/Q-<n>/QA.md` with the same
//! number; answered and withdrawn questions are dropped. A start approval is not carried over:
//! the AI tasks that wait on it move to the Backlog, which a person sends to Todo. References to the
//! dropped questions leave the tasks, so no task waits for a question that no longer exists.
//! After this only the new format exists.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::super::save::task_pair_changes;
use super::message_change;
use crate::domain::{Assignee, Column, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::frontmatter::{compose_questions, questions_of};
use crate::file_store::model::{Choice, HistoryRecord};
use crate::file_store::qa::{self, Message, Question, question_defect, question_number};
use crate::file_store::transaction::{FileChange, save_batch_locked};
use crate::file_store::validate::is_hex32;
use crate::file_store::{FileStore, io, layout, reader};

/// `request.json` as the earlier format wrote it. Only what the conversion needs is read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRequest {
    #[serde(with = "crate::clock::serde_utc")]
    created_at: DateTime<Utc>,
    #[serde(default, with = "crate::clock::serde_opt_utc")]
    withdrawn_at: Option<DateTime<Utc>>,
    questions: Vec<LegacyQuestion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyQuestion {
    id: String,
    #[serde(default)]
    kind: String,
    question: String,
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    recommended_choice_id: Option<String>,
    #[serde(default)]
    answer: Option<serde_json::Value>,
}

/// The folders of the earlier format: `qa/<32 hex digits>/`.
fn legacy_dirs(project_dir: &Path) -> Result<Vec<PathBuf>, AgboardError> {
    let dir = qa::qa_dir(project_dir);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let label = layout::project_label(project_dir, &dir);
    let mut found = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| io::read_error(&label, e))? {
        let entry = entry.map_err(|e| io::read_error(&label, e))?;
        if entry.file_name().to_str().is_some_and(is_hex32) && entry.path().is_dir() {
            found.push(entry.path());
        }
    }
    found.sort();
    Ok(found)
}

/// What the old files hold: the questions to carry over, and the numbers that go away.
#[derive(Default)]
struct Found {
    open: Vec<(Question, DateTime<Utc>)>,
    dropped: Vec<String>,
    approvals: Vec<String>,
    /// Folders whose `request.json` cannot be read; they are kept aside, not lost.
    unreadable: Vec<PathBuf>,
}

fn read_legacy(dirs: &[PathBuf]) -> Found {
    let mut found = Found::default();
    for dir in dirs {
        let parsed = fs::read(dir.join("request.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<LegacyRequest>(&bytes).ok());
        let Some(request) = parsed else {
            found.unreadable.push(dir.clone());
            continue;
        };
        for old in request.questions {
            if question_number(&old.id).is_none() {
                continue;
            }
            let is_open = old.answer.is_none() && request.withdrawn_at.is_none();
            if !is_open {
                found.dropped.push(old.id);
            } else if old.kind == "start_approval" {
                found.approvals.push(old.id);
            } else {
                let question = Question {
                    id: old.id.clone(),
                    body: old.question.trim().to_owned(),
                    tasks: Vec::new(),
                    choices: old.choices,
                    recommended: old.recommended_choice_id,
                    reply: None,
                    withdrawn_at: None,
                    created_at: request.created_at,
                    asked_by: None,
                };
                if question_defect(&question).is_some() {
                    found.dropped.push(old.id);
                } else {
                    found.open.push((question, request.created_at));
                }
            }
        }
    }
    found
}

/// Convert the old request files of a project, if there are any. The caller holds the
/// project lock. Returns whether anything was converted.
pub(in crate::file_store) fn migrate_legacy_locked(
    shared: &Path,
    project: &ProjectId,
    project_dir: &Path,
) -> Result<bool, AgboardError> {
    let dirs = legacy_dirs(project_dir)?;
    if dirs.is_empty() {
        return Ok(false);
    }
    let mut found = read_legacy(&dirs);
    // A question that already has its new file (an interrupted conversion) is not written again.
    found
        .open
        .retain(|(q, _)| !qa::message_dir(project_dir, &q.id).exists());
    let kept: Vec<String> = found.open.iter().map(|(q, _)| q.id.clone()).collect();
    let gone: Vec<&String> = found.dropped.iter().chain(&found.approvals).collect();
    let store = FileStore::open(shared);
    let at = super::super::stamp(Utc::now());

    let mut changes = Vec::new();
    for task_id in reader::task_ids(project_dir)? {
        let (Ok(mut task), Ok(text)) = (
            reader::read_task_strict(shared, project, task_id),
            reader::read_body(shared, project, task_id),
        ) else {
            continue;
        };
        let Ok(refs) = questions_of(&text) else {
            continue;
        };
        for (question, _) in &mut found.open {
            if refs.contains(&question.id) && !question.tasks.contains(&task_id) {
                question.tasks.push(task_id);
            }
        }
        let remaining: Vec<String> = refs
            .iter()
            .filter(|id| !gone.contains(id))
            .cloned()
            .collect();
        let waits_on_approval = refs.iter().any(|id| found.approvals.contains(id));
        let draftable = task.assignee == Assignee::Ai
            && task.archived_at.is_none()
            && task.task_status == Column::Todo
            && task.agent_status == RunState::Idle
            && task.draft.is_none();
        let drafted = waits_on_approval && draftable;
        if remaining.len() == refs.len() && !drafted {
            continue;
        }
        if drafted {
            let language = store.history_language(project, &task)?;
            task.task_status = Column::Backlog;
            task.updated_at = at;
            task.history.push(HistoryRecord {
                at,
                reason: language
                    .text(
                        "A start approval that was waiting for an answer moved the task to the Backlog; a person sends it to Todo.",
                        "回答待ちだった開始の承認により、タスクは Backlog に移りました。人が Todo へ送ります。",
                    )
                    .to_owned(),
            });
        }
        let composed =
            compose_questions(&text, &remaining).map_err(|d| AgboardError::FileInvalid {
                file: format!("tasks/{task_id}/TASK.md"),
                field: d.field,
                reason: d.reason,
            })?;
        changes.extend(task_pair_changes(
            shared,
            project_dir,
            &task,
            Some(&composed),
        )?);
    }
    for (question, _) in found.open.drain(..) {
        debug_assert!(kept.contains(&question.id));
        changes.push(message_change(
            project_dir,
            &Message::Question(question),
            true,
        )?);
    }
    if !changes.is_empty() {
        save_batch_locked(project_dir, changes_ordered(changes))?;
    }

    // Only now are the old folders removed; an interrupted run finds them again and finishes.
    let aside = project_dir.join(".internal").join("legacy-qa");
    for dir in dirs {
        if found.unreadable.contains(&dir) {
            fs::create_dir_all(&aside).map_err(|e| io::write_error("legacy-qa", e))?;
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned());
            let target = aside.join(name.unwrap_or_default());
            fs::rename(&dir, target).map_err(|e| io::write_error("legacy-qa", e))?;
        } else {
            fs::remove_dir_all(&dir).map_err(|e| io::write_error("qa", e))?;
        }
    }
    io::sync_dir(&qa::qa_dir(project_dir)).map_err(|e| io::write_error("qa", e))?;
    Ok(true)
}

fn changes_ordered(changes: Vec<FileChange>) -> Vec<FileChange> {
    changes
}
