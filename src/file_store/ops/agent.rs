//! Agent operations: lane moves and run states.
//!
//! A lane move returns the task to idle and releases its request. A run-state
//! change keeps the lane. A completion report is an idle state in Doing, so
//! the task stays in Doing until the coordinator moves it.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::frontmatter;
use super::super::layout;
use super::super::model::{Choice, PendingRequest, TaskView};
use super::super::reader;
use super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lane_end, lock_project, new_id, save_task,
    stamp, transition_event,
};
use crate::domain::{
    Actor, ChangeContext, Changed, Column, MAX_CHOICES, ProjectId, RunState, check_work_state,
};
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
        self.move_task(project, id, to, ctx, now, true)
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
        self.move_task(project, id, to, ctx, now, false)
    }

    fn move_task(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
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
        ensure_ai_task_not_done(&task, ctx.actor)?;
        if block_drafts && task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        if ctx.actor == Actor::Ai && to == Column::Done && task.task_status != Column::Done {
            ensure_acceptance_met(shared, project, id)?;
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
        task.pending_request_id = None;
        task.pending_request = None;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_task_locked(shared, project, id)?,
            changed: true,
        })
    }

    /// Change a task's run state. Only an AI-owned task in Doing can run or
    /// wait. A state that is already set is not a change, whatever the reason.
    /// Leaving pending needs the current request ID in `expected_request`.
    pub fn set_agent_status(
        &self,
        project: &ProjectId,
        id: i64,
        state: RunState,
        ctx: ChangeContext,
        expected_request: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        self.change_state(
            project,
            id,
            state,
            ctx.actor,
            &ctx.reason,
            expected_request,
            Vec::new(),
            now,
        )
    }

    /// The shared body of a run-state change. A change to pending records the
    /// reason as the question and `choices` as the options, with a new request ID.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn change_state(
        &self,
        project: &ProjectId,
        id: i64,
        state: RunState,
        actor: Actor,
        reason: &str,
        expected_request: Option<&str>,
        choices: Vec<Choice>,
        now: DateTime<Utc>,
    ) -> Result<Changed<TaskView>, AgboardError> {
        if state == RunState::Pending && choices.len() > MAX_CHOICES {
            return Err(AgboardError::InvalidValue {
                field: "choices".into(),
                reason: "A pending request needs a question and up to 10 choices.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::TaskArchived { id });
        }
        ensure_ai_task_not_done(&task, actor)?;
        if task.is_draft {
            return Err(AgboardError::TaskIsDraft { id });
        }
        check_work_state(task.assignee, task.task_status, state)?;
        if task.agent_status == state {
            return Ok(Changed {
                value: reader::read_task_locked(shared, project, id)?,
                changed: false,
            });
        }
        if task.agent_status == RunState::Pending
            && expected_request != task.pending_request_id.as_deref()
        {
            return Err(AgboardError::RequestChanged);
        }
        let reason = if state == RunState::Pending {
            super::super::validate::normalize_question(reason)?
        } else {
            reason.to_owned()
        };
        let at = stamp(now);
        let request_id = if state == RunState::Pending {
            Some(new_id()?)
        } else {
            None
        };
        let language = self.history_language(project, &task)?;
        let event_reason = if state == RunState::Pending {
            let options = choices
                .iter()
                .map(|choice| format!("{}: {}", choice.id, choice.label))
                .collect::<Vec<_>>()
                .join("; ");
            let english = format!(
                "Requested decision: {reason}{}",
                if options.is_empty() {
                    String::new()
                } else {
                    format!(" Options: {options}")
                }
            );
            let japanese = format!(
                "判断を依頼しました: {reason}{}",
                if options.is_empty() {
                    String::new()
                } else {
                    format!(" 選択肢: {options}")
                }
            );
            language.text(&english, &japanese).to_owned()
        } else {
            reason.to_owned()
        };
        let event = transition_event(Transition {
            language: self.history_language(project, &task)?,
            kind: HistoryKind::Agent,
            reason: Some(&event_reason),
            from_task: Some(task.task_status),
            to_task: task.task_status,
            from_agent: Some(task.agent_status),
            to_agent: state,
            at,
        })?;
        task.pending_request = (state == RunState::Pending).then(|| PendingRequest {
            question: reason.to_owned(),
            choices,
        });
        task.agent_status = state;
        task.pending_request_id = request_id;
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
