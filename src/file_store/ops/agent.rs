//! Agent operations: lane moves and run states.
//!
//! A lane move returns the task to idle; the questions a task refers to stay. A run-state
//! change keeps the lane. A completion report is an idle state in Doing, so
//! the task stays in Doing until the coordinator moves it.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::frontmatter;
use super::super::layout;
use super::super::model::TaskView;
use super::super::reader;
use super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lane_end, lock_project, save_task, stamp,
    task_waits, transition_event,
};
use crate::domain::{Actor, ChangeContext, Changed, Column, ProjectId, RunState, check_work_state};
use crate::error::AgboardError;

/// An agent may move a task to Done only when its frontmatter reads and every
/// condition is done. A person's move is never checked here.
fn ensure_acceptance_met(
    shared: &std::path::Path,
    project: &ProjectId,
    id: i64,
) -> Result<(), AgboardError> {
    let text = reader::read_body(shared, project, id)?;
    let parsed = frontmatter::parse(&text);
    if let Some(defect) = parsed.defects.into_iter().next() {
        let path = layout::task_md(&layout::task_dir(&layout::project_dir(shared, project), id));
        return Err(AgboardError::FileInvalid {
            file: layout::shared_label(shared, &path),
            field: defect.field,
            reason: defect.reason,
        });
    }
    let unmet: Vec<String> = parsed
        .acceptance
        .iter()
        .filter(|item| !item.done)
        .map(|item| item.id.clone())
        .collect();
    if unmet.is_empty() {
        Ok(())
    } else {
        Err(AgboardError::AcceptanceUnmet { id, unmet })
    }
}

impl FileStore {
    /// Move a task to the end of a lane. A draft is refused for agents.
    pub fn move_work_task(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.move_task(project, id, to, None, ctx, now, true)
    }

    /// The same move for a user in the Web UI: drafts can be moved.
    pub fn move_work_task_for_user(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.move_task(project, id, to, None, ctx, now, false)
    }

    /// [`FileStore::move_work_task_for_user`] for a move that names the status it started from:
    /// a task that is no longer there is `task_status_changed`, so the history never records a
    /// transition from a status the user did not see.
    pub fn move_work_task_for_user_from(
        &self,
        project: &ProjectId,
        id: i64,
        from: Column,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.move_task(project, id, to, Some(from), ctx, now, false)
    }

    #[allow(clippy::too_many_arguments)]
    fn move_task(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        from: Option<Column>,
        ctx: ChangeContext,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<Changed<TaskView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        if let Some(from) = from
            && task.task_status != from
        {
            return Err(AgboardError::TaskStatusChanged {
                id,
                current: task.task_status,
            });
        }
        ensure_ai_task_not_done(&task, ctx.actor)?;
        if block_drafts && task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        if ctx.actor == Actor::Ai && to == Column::Done && task.task_status != Column::Done {
            ensure_acceptance_met(shared, project, id)?;
            if task_waits(shared, project, id)? {
                return Err(AgboardError::QuestionsUnanswered { id });
            }
        }
        if task.task_status == to {
            return Ok(Changed {
                value: reader::read_task_locked(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let position = lane_end(shared, project, to)?;
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Lane,
            reason: Some(&ctx.reason),
            from_task: Some(task.task_status),
            to_task: to,
            from_agent: Some(task.agent_status),
            to_agent: RunState::Idle,
            at,
        })?;
        if task.agent_status != RunState::Idle {
            task.agent_status_changed_at = at;
        }
        task.task_status = to;
        task.task_status_changed_at = at;
        task.position = position;
        task.agent_status = RunState::Idle;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, id)?,
            changed: true,
        })
    }

    /// Change a task's run state. Only an AI-owned task in Doing can run, and an agent cannot
    /// run a task that waits for answers. A state that is already set is not a change,
    /// whatever the reason. Waiting is never stored: it is read from the questions.
    pub fn set_agent_status(
        &self,
        project: &ProjectId,
        id: i64,
        state: RunState,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        if state == RunState::Pending {
            return Err(AgboardError::InvalidValue {
                field: "agentStatus".into(),
                reason: "The run state is idle or running. Ask questions with qa ask.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        ensure_ai_task_not_done(&task, ctx.actor)?;
        if task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        check_work_state(task.assignee, task.task_status, state)?;
        if ctx.actor == Actor::Ai && state == RunState::Running && task_waits(shared, project, id)?
        {
            return Err(AgboardError::QuestionsUnanswered { id });
        }
        if task.agent_status == state {
            return Ok(Changed {
                value: reader::read_task_locked(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Agent,
            reason: Some(&ctx.reason),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(task.agent_status),
            to_agent: state,
            at,
        })?;
        task.agent_status = state;
        task.agent_status_changed_at = at;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, id)?,
            changed: true,
        })
    }
}
