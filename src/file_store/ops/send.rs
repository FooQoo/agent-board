//! Sending a plan to Todo: one card, or the cards of an epic.
//!
//! Sending is the only operation that takes a card out of the Backlog, and only
//! a person can do it. Saving, answering and checking conditions never do. An
//! open question is a warning the person confirms (`ack`). An epic is sent in
//! one batch: if any card cannot be sent, none is.

use std::path::Path;

use chrono::{DateTime, Utc};

use crate::domain::{Actor, Changed, Column, Draft, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::layout;
use crate::file_store::model::{EpicView, HistoryRecord, TaskFile, TaskView};
use crate::file_store::qa::{MessageState, QaIndex, question_number};
use crate::file_store::reader;
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::validate::EpicId;

use super::epic::{epic_view, read_epic_file};
use super::save::{save_task, task_pair_changes};
use super::{HistoryKind, Transition, lane_end, lock_project, stamp, transition_event};

/// What sending an epic changed: the epic as it is now and the numbers of the
/// cards that went to Todo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicSent {
    pub epic: EpicView,
    pub sent: Vec<i64>,
}

/// The numbers of the open questions about any of `tasks`, lowest first.
fn open_questions(
    shared: &Path,
    project: &ProjectId,
    tasks: &[i64],
) -> Result<Vec<String>, AgboardError> {
    let project_dir = layout::project_dir(shared, project);
    let index = QaIndex::load(shared, &project_dir)?;
    let mut open: Vec<_> = index
        .questions()
        .filter(|q| q.state() == MessageState::Open && q.tasks.iter().any(|t| tasks.contains(t)))
        .map(|q| q.id.clone())
        .collect();
    open.sort_by_key(|id| question_number(id).unwrap_or(i64::MAX));
    Ok(open)
}

/// Only a person sends a plan. An open question is a warning they confirm
/// with `ack`; the question stays, so no agent can run the card until it is
/// answered.
fn check_sender(actor: Actor, ack: bool, open: Vec<String>) -> Result<(), AgboardError> {
    if actor == Actor::Ai {
        return Err(AgboardError::HumanOnly {
            action: "sending a plan to Todo".into(),
        });
    }
    if !open.is_empty() && !ack {
        return Err(AgboardError::SendWithOpenQuestions { ids: open });
    }
    Ok(())
}

fn send_event(
    task: &TaskFile,
    at: DateTime<Utc>,
    language: HistoryLanguage,
) -> Result<HistoryRecord, AgboardError> {
    let reason = language.text(
        "A person sent the task to Todo.",
        "人が Todo へ送りました。",
    );
    transition_event(Transition {
        language,
        kind: HistoryKind::Lane,
        reason: Some(reason),
        from_task: Some(task.task_status),
        to_task: Column::Todo,
        from_agent: Some(task.agent_status),
        to_agent: task.agent_status,
        at,
    })
}

/// Put a Backlog card at the end of Todo and record who sent it.
fn move_to_todo(
    task: &mut TaskFile,
    position: i64,
    at: DateTime<Utc>,
    language: HistoryLanguage,
) -> Result<(), AgboardError> {
    let event = send_event(task, at, language)?;
    task.task_status = Column::Todo;
    task.position = position;
    task.task_status_changed_at = at;
    task.updated_at = at;
    task.history.push(event);
    Ok(())
}

impl FileStore {
    /// Send one Backlog card to Todo, at the end of the lane. A card that is
    /// already out of the Backlog changes nothing, so a retry is safe. A card a
    /// person is editing (`draft: human`) is refused with `task_is_draft`.
    pub fn send_task(
        &self,
        project: &ProjectId,
        id: i64,
        actor: Actor,
        ack: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let task = reader::read_task_strict(shared, project, id)?;
        self.send_task_locked(project, &project_dir, task, actor, ack, now)
    }

    /// [`FileStore::send_task`] with the project lock held and the card read.
    pub(super) fn send_task_locked(
        &self,
        project: &ProjectId,
        project_dir: &Path,
        mut task: TaskFile,
        actor: Actor,
        ack: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let id = task.id;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if task.draft == Some(Draft::Human) {
            return Err(AgboardError::TaskIsDraft { id });
        }
        if task.task_status != Column::Backlog {
            return Ok(Changed {
                value: reader::read_task_locked(shared, project, id)?,
                changed: false,
            });
        }
        check_sender(actor, ack, open_questions(shared, project, &[id])?)?;
        let language = self.history_language(project, &task)?;
        let position = lane_end(shared, project, Column::Todo)?;
        move_to_todo(&mut task, position, stamp(now), language)?;
        save_task(shared, project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, id)?,
            changed: true,
        })
    }

    /// Send the Backlog cards of an epic to Todo in one save: all of them, or
    /// only `task_ids`. Nothing is sent when any of them cannot be: a card a
    /// person is editing, or an open question an agent or an unconfirmed person
    /// meets. A card that is not in the Backlog is left as it is.
    pub fn send_epic(
        &self,
        project: &ProjectId,
        id: &EpicId,
        task_ids: Option<&[i64]>,
        actor: Actor,
        ack: bool,
        now: DateTime<Utc>,
    ) -> Result<Changed<EpicSent>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let (_, epic) = read_epic_file(shared, project, id)?;
        if epic.draft == Some(Draft::Human) {
            return Err(AgboardError::EpicIsDraft { id: id.to_string() });
        }
        let mut members = Vec::new();
        for task_id in reader::task_ids(&project_dir)? {
            let task = reader::read_task_strict(shared, project, task_id)?;
            if task.epic_id.as_deref() == Some(id.as_str()) && task.archived_at.is_none() {
                members.push(task);
            }
        }
        if let Some(stray) =
            task_ids.and_then(|ids| ids.iter().find(|n| !members.iter().any(|t| t.id == **n)))
        {
            return Err(AgboardError::InvalidValue {
                field: "taskIds".into(),
                reason: format!("task #{stray} is not an open card of epic {id}."),
            });
        }
        let mut chosen: Vec<TaskFile> = members
            .into_iter()
            .filter(|t| t.task_status == Column::Backlog)
            .filter(|t| task_ids.is_none_or(|ids| ids.contains(&t.id)))
            .collect();
        chosen.sort_by_key(|t| (t.position, t.id));
        if let Some(task) = chosen.iter().find(|t| t.draft == Some(Draft::Human)) {
            return Err(AgboardError::TaskIsDraft { id: task.id });
        }
        let sent: Vec<i64> = chosen.iter().map(|t| t.id).collect();
        if chosen.is_empty() {
            return Ok(Changed {
                value: EpicSent {
                    epic: epic_view(shared, project, id)?,
                    sent,
                },
                changed: false,
            });
        }
        check_sender(actor, ack, open_questions(shared, project, &sent)?)?;

        let at = stamp(now);
        let first = lane_end(shared, project, Column::Todo)?;
        let mut changes = Vec::new();
        for (position, task) in (first..).zip(chosen.iter_mut()) {
            let language = self.history_language(project, task)?;
            move_to_todo(task, position, at, language)?;
            changes.extend(task_pair_changes(shared, &project_dir, task, None)?);
        }
        save_batch_locked(&project_dir, changes)?;
        Ok(Changed {
            value: EpicSent {
                epic: epic_view(shared, project, id)?,
                sent,
            },
            changed: true,
        })
    }
}
