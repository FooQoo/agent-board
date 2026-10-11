//! Decision requests and their answers.
//!
//! A request is saved as a history event of the card, with its question and
//! choices. The card names the request only by its ID. An answer must name
//! the current request ID; it returns the card to idle and records the answer
//! in history.

use chrono::{DateTime, Utc};

use super::super::FileStore;
use super::super::model::{CardView, Choice, HistoryKind, current_request};
use super::super::reader;
use super::super::validate;
use super::{Transition, lock_project, save_task, stamp, transition_event};
use crate::domain::{Actor, Assignee, Changed, Column, ProjectId, RunState};
use crate::error::AgboardError;

/// An answer to the pending request: a choice, a note, or both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub actor: Actor,
    pub choice_id: Option<String>,
    pub text: Option<String>,
}

impl FileStore {
    /// Ask a question of the user. The card goes to pending with a new request
    /// ID. An empty choice list makes a reason-only request. A card that is
    /// already pending is not changed.
    pub fn request_decision(
        &self,
        project: &ProjectId,
        id: i64,
        actor: Actor,
        question: &str,
        choices: Vec<Choice>,
        now: DateTime<Utc>,
    ) -> Result<Changed<CardView>, AgboardError> {
        let question = validate::normalize_question(question)?;
        let choices = validate::normalize_choices(choices)?;
        self.change_state(
            project,
            id,
            RunState::Pending,
            actor,
            &question,
            None,
            choices,
            now,
        )
    }

    /// Answer the pending request `request_id`. The answer may name a choice of
    /// the request, give a text, or both, but not neither. The card returns to
    /// idle, and the answer is recorded in history.
    pub fn answer_request(
        &self,
        project: &ProjectId,
        id: i64,
        request_id: &str,
        answer: Answer,
        now: DateTime<Utc>,
    ) -> Result<CardView, AgboardError> {
        let text = validate::normalize_answer_text(answer.text.as_deref().unwrap_or(""))?;
        let choice_id = answer.choice_id.filter(|c| !c.is_empty());
        if choice_id.is_none() && text.is_none() {
            return Err(AgboardError::InvalidValue {
                field: "answer".into(),
                reason: "Choose an option, write a text answer, or both.".into(),
            });
        }

        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut task = reader::read_task_strict(shared, project, id)?;
        if task.archived_at.is_some() {
            return Err(AgboardError::CardArchived { id });
        }
        if task.assignee != Assignee::Ai
            || task.card_status != Column::Doing
            || task.agent_status != RunState::Pending
            || task.pending_request_id.as_deref() != Some(request_id)
        {
            return Err(AgboardError::RequestChanged);
        }
        let choices = current_request(&task)
            .ok_or(AgboardError::RequestChanged)?
            .choices
            .clone()
            .unwrap_or_default();
        let choice_label = match &choice_id {
            None => None,
            Some(choice) => Some(
                choices
                    .iter()
                    .find(|c| &c.id == choice)
                    .ok_or_else(|| AgboardError::RequestChoiceUnknown {
                        request_id: request_id.to_string(),
                        choice_id: choice.clone(),
                    })?
                    .label
                    .clone(),
            ),
        };

        let at = stamp(now);
        let mut event = transition_event(Transition {
            kind: HistoryKind::Answer,
            actor: answer.actor,
            reason: text.as_deref(),
            from_card: Some(Column::Doing),
            to_card: Column::Doing,
            from_agent: Some(RunState::Pending),
            to_agent: RunState::Idle,
            request_id: Some(request_id),
            at,
        })?;
        event.choice_id = choice_id;
        event.choice_label = choice_label;
        task.agent_status = RunState::Idle;
        task.pending_request_id = None;
        task.agent_status_changed_at = at;
        task.updated_at = at;
        task.history.push(event);
        save_task(shared, &project_dir, &task)?;
        reader::read_card(shared, project, id)
    }
}
