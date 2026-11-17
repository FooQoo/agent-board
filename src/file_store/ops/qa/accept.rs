//! Accepting what a person wrote: a request, or the answer to a question. The acceptance is the
//! agent's receipt; it is written once.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::message_change;
use crate::domain::{Actor, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{Message, MessageState, QuestionView, RequestView, read_message};
use crate::file_store::transaction::save_batch_locked;

/// A message after an agent accepted it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Accepted {
    Request(RequestView),
    Question(QuestionView),
}

impl FileStore {
    /// An agent accepts a request or the answer of a question. The first acceptance is final:
    /// a second one is `request_accepted` or `answer_accepted`. A withdrawn request takes none
    /// (`request_withdrawn`), and neither does a question without an answer (`question_open`,
    /// `question_withdrawn`).
    pub fn accept_message(
        &self,
        project: &ProjectId,
        id: &str,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Accepted, AgboardError> {
        if actor != Actor::Ai {
            return Err(AgboardError::AiOnly {
                action: "accepting a message".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let message = match read_message(shared, &project_dir, id)? {
            Message::Request(mut request) => {
                match request.state() {
                    MessageState::Withdrawn => {
                        return Err(AgboardError::RequestWithdrawn { id: id.to_owned() });
                    }
                    MessageState::Closed => {
                        return Err(AgboardError::RequestAccepted { id: id.to_owned() });
                    }
                    MessageState::Open => {}
                }
                request.accepted_at = Some(stamp(now));
                Message::Request(request)
            }
            Message::Question(mut question) => {
                match question.state() {
                    MessageState::Withdrawn => {
                        return Err(AgboardError::QuestionWithdrawn {
                            ids: vec![id.to_owned()],
                        });
                    }
                    MessageState::Open => {
                        return Err(AgboardError::QuestionOpen { id: id.to_owned() });
                    }
                    MessageState::Closed => {}
                }
                let reply = question.reply.as_mut().expect("an answered question");
                if reply.accepted_at.is_some() {
                    return Err(AgboardError::AnswerAccepted { id: id.to_owned() });
                }
                reply.accepted_at = Some(stamp(now));
                Message::Question(question)
            }
        };
        let change = message_change(&project_dir, &message, false)?;
        save_batch_locked(&project_dir, vec![change])?;
        Ok(match message {
            Message::Request(request) => Accepted::Request(RequestView::of(&request)),
            Message::Question(question) => {
                Accepted::Question(QuestionView::of(&question, Vec::new()))
            }
        })
    }

    /// Accept every answer among the questions `ids` that no agent took in yet: the wait that
    /// returned them has handed them over. Open, withdrawn and accepted questions are left as
    /// they are. Returns the IDs written.
    pub fn accept_answers(
        &self,
        project: &ProjectId,
        ids: &[String],
        now: DateTime<Utc>,
    ) -> Result<Vec<String>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let at = stamp(now);
        let mut changes = Vec::new();
        let mut written = Vec::new();
        for id in ids {
            let Message::Question(mut question) = read_message(shared, &project_dir, id)? else {
                continue;
            };
            if question.state() != MessageState::Closed {
                continue;
            }
            let Some(reply) = question.reply.as_mut().filter(|r| r.accepted_at.is_none()) else {
                continue;
            };
            reply.accepted_at = Some(at);
            changes.push(message_change(
                &project_dir,
                &Message::Question(question),
                false,
            )?);
            written.push(id.clone());
        }
        if !changes.is_empty() {
            save_batch_locked(&project_dir, changes)?;
        }
        Ok(written)
    }
}
