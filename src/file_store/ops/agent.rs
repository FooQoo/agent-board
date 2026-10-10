//! Agent operations: lane moves and run states.
//!
//! A lane move returns the card to idle and releases its request. A run-state
//! change keeps the lane. A completion report is an idle state in Doing, so
//! the card stays in Doing until the coordinator moves it.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::model::{CardView, Choice, HistoryKind};
use super::super::reader;
use super::{Transition, lane_end, lock_project, new_id, save_task, stamp, transition_event};
use crate::domain::{
    Actor, ChangeContext, Changed, Column, ProjectId, RunState, check_work_state,
    validate_work_reason,
};
use crate::error::SkanError;

impl FileStore {
    /// Move a card to the end of a lane. A draft is refused for agents.
    pub fn move_work_card(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<CardView>, SkanError> {
        self.move_card(project, id, to, ctx, now, true)
    }

    /// The same move for a user in the Web UI: drafts can be moved.
    pub fn move_work_card_for_user(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
    ) -> Result<Changed<CardView>, SkanError> {
        self.move_card(project, id, to, ctx, now, false)
    }

    fn move_card(
        &self,
        project: &ProjectId,
        id: i64,
        to: Column,
        ctx: ChangeContext,
        now: DateTime<Utc>,
        block_drafts: bool,
    ) -> Result<Changed<CardView>, SkanError> {
        let reason = validate_work_reason(&ctx.reason)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(SkanError::CardArchived { id });
        }
        if block_drafts && task.is_draft {
            return Err(SkanError::CardIsDraft { id });
        }
        if task.card_status == to {
            return Ok(Changed {
                value: reader::read_card(shared, project, id)?,
                changed: false,
            });
        }
        let at = stamp(now);
        let position = lane_end(shared, project, to)?;
        let event = transition_event(Transition {
            kind: HistoryKind::Lane,
            actor: ctx.actor,
            reason: Some(&reason),
            from_card: Some(task.card_status),
            to_card: to,
            from_agent: Some(task.agent_status),
            to_agent: RunState::Idle,
            request_id: task.pending_request_id.as_deref(),
            at,
        })?;
        if task.agent_status != RunState::Idle {
            task.agent_status_changed_at = at;
        }
        task.card_status = to;
        task.position = position;
        task.agent_status = RunState::Idle;
        task.pending_request_id = None;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_card(shared, project, id)?,
            changed: true,
        })
    }

    /// Change a card's run state. Only an AI-owned card in Doing can run or
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
    ) -> Result<Changed<CardView>, SkanError> {
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
    ) -> Result<Changed<CardView>, SkanError> {
        let reason = validate_work_reason(reason)?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(SkanError::CardArchived { id });
        }
        if task.is_draft {
            return Err(SkanError::CardIsDraft { id });
        }
        check_work_state(task.assignee, task.card_status, state)?;
        if task.agent_status == state {
            return Ok(Changed {
                value: reader::read_card(shared, project, id)?,
                changed: false,
            });
        }
        if task.agent_status == RunState::Pending
            && expected_request != task.pending_request_id.as_deref()
        {
            return Err(SkanError::RequestChanged);
        }
        let at = stamp(now);
        let request_id = if state == RunState::Pending {
            Some(new_id()?)
        } else {
            None
        };
        let mut event = transition_event(Transition {
            kind: HistoryKind::Agent,
            actor,
            reason: Some(&reason),
            from_card: Some(task.card_status),
            to_card: task.card_status,
            from_agent: Some(task.agent_status),
            to_agent: state,
            request_id: request_id.as_deref(),
            at,
        })?;
        if state == RunState::Pending {
            event.question = Some(reason.clone());
            event.choices = Some(choices);
        }
        task.agent_status = state;
        task.pending_request_id = request_id;
        task.agent_status_changed_at = at;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        Ok(Changed {
            value: reader::read_card(shared, project, id)?,
            changed: true,
        })
    }
}
