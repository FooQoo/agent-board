//! Starting an AI draft: one task, or an epic with all its AI drafts. The agent that wrote the
//! plan starts it once the questions about it are answered and it has written the plan up;
//! a person can start it too.

use std::path::Path;

use chrono::{DateTime, Utc};

use crate::domain::{Actor, Changed, Draft, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::history_language::HistoryLanguage;
use crate::file_store::io;
use crate::file_store::layout;
use crate::file_store::model::{EpicView, HistoryRecord, TaskFile, TaskView};
use crate::file_store::qa::{MessageState, QaIndex, question_number};
use crate::file_store::reader;
use crate::file_store::transaction::{FileChange, save_batch_locked};
use crate::file_store::validate::EpicId;

use super::epic::{epic_view, read_epic_file};
use super::save::{save_task, task_pair_changes};
use super::{HistoryKind, Transition, lock_project, stamp, transition_event};

/// What starting an epic changed: the epic as it is now and the numbers of the
/// tasks that left the AI draft with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicStarted {
    pub epic: EpicView,
    pub started: Vec<i64>,
}

/// The place for rules that stop a start. A start that must wait for something
/// (an unanswered question about the plan, for example) is refused here, before
/// anything is written. `epic` is set when an epic is started, and `tasks` holds
/// the AI-draft tasks that the start would clear.
fn ensure_startable(
    shared: &Path,
    project: &ProjectId,
    _epic: Option<&EpicId>,
    tasks: &[i64],
) -> Result<(), AgboardError> {
    let project_dir = layout::project_dir(shared, project);
    let index = QaIndex::load(shared, &project_dir)?;
    let mut open: Vec<_> = index
        .questions()
        .filter(|q| q.state() == MessageState::Open && q.tasks.iter().any(|t| tasks.contains(t)))
        .map(|q| q.id.clone())
        .collect();
    if open.is_empty() {
        return Ok(());
    }
    open.sort_by_key(|id| question_number(id).unwrap_or(i64::MAX));
    Err(AgboardError::StartBlockedByQuestions { ids: open })
}

fn start_event(
    task: &TaskFile,
    actor: Actor,
    at: DateTime<Utc>,
    language: HistoryLanguage,
) -> Result<HistoryRecord, AgboardError> {
    let reason = match actor {
        Actor::Human => language.text("A person started the task.", "人がタスクを開始しました。"),
        Actor::Ai => language.text(
            "The agent wrote the plan up and started the task.",
            "AI が計画を清書し、タスクを開始しました。",
        ),
    };
    transition_event(Transition {
        language,
        kind: HistoryKind::Draft,
        reason: Some(reason),
        from_task: Some(task.task_status),
        to_task: task.task_status,
        from_agent: Some(task.agent_status),
        to_agent: task.agent_status,
        at,
    })
}

impl FileStore {
    /// Start one task: its AI draft is cleared and the history records who started
    /// it. An open question on the task refuses the start. A task that is not a draft
    /// changes nothing; a person's own draft is finalized, not started.
    pub fn start_task(
        &self,
        project: &ProjectId,
        id: i64,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        match task.draft {
            None => {
                return Ok(Changed {
                    value: reader::read_task_locked(shared, project, id)?,
                    changed: false,
                });
            }
            Some(Draft::Human) => return Err(AgboardError::TaskIsDraft { id }),
            Some(Draft::Ai) => {}
        }
        ensure_startable(shared, project, None, &[id])?;
        let language = self.history_language(project, &task)?;
        task.draft = None;
        task.history.push(start_event(&task, actor, stamp(now), language)?);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, id)?,
            changed: true,
        })
    }

    /// Start an epic: the epic and every task of it that is an AI draft leave the
    /// draft in one save, and each such task records that a person started it.
    /// A person's own draft tasks stay drafts. An open question on any of them refuses
    /// the start. Nothing
    /// to start changes nothing.
    pub fn start_epic(
        &self,
        project: &ProjectId,
        id: &EpicId,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Changed<EpicStarted>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let (epic_dir, mut epic) = read_epic_file(shared, project, id)?;
        if epic.draft == Some(Draft::Human) {
            return Err(AgboardError::EpicIsDraft { id: id.to_string() });
        }
        let mut tasks = Vec::new();
        for task_id in reader::task_ids(&project_dir)? {
            let task = reader::read_task_strict(shared, project, task_id)?;
            if task.epic_id.as_deref() == Some(id.as_str())
                && task.archived_at.is_none()
                && task.draft == Some(Draft::Ai)
            {
                tasks.push(task);
            }
        }
        if epic.draft.is_none() && tasks.is_empty() {
            return Ok(Changed {
                value: EpicStarted {
                    epic: epic_view(shared, project, id)?,
                    started: Vec::new(),
                },
                changed: false,
            });
        }
        let task_ids: Vec<i64> = tasks.iter().map(|task| task.id).collect();
        ensure_startable(shared, project, Some(id), &task_ids)?;

        let at = stamp(now);
        let mut changes = Vec::new();
        for task in &mut tasks {
            let language = self.history_language(project, task)?;
            task.draft = None;
            task.history.push(start_event(task, actor, at, language)?);
            changes.extend(task_pair_changes(shared, &project_dir, task, None)?);
        }
        if epic.draft.is_some() {
            let path = layout::epic_file(&epic_dir);
            let label = layout::shared_label(shared, &path);
            let old = io::read_bytes(&path, &label)?;
            epic.draft = None;
            epic.updated_at = at;
            let mut new =
                serde_json::to_vec_pretty(&epic).map_err(|e| io::write_error(&label, e))?;
            new.push(b'\n');
            changes.push(FileChange {
                target: std::path::PathBuf::from(format!("epics/{id}/epic.json")),
                old: Some(old),
                new: Some(new),
            });
        }
        save_batch_locked(&project_dir, changes)?;
        Ok(Changed {
            value: EpicStarted {
                epic: epic_view(shared, project, id)?,
                started: task_ids,
            },
            changed: true,
        })
    }
}
