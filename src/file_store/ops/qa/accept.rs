//! Accepting a request. The acceptance is the agent's receipt; only one agent can write it.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::message_change;
use crate::domain::{Actor, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::qa::{
    MAX_ACCEPTED_BY_CHARS, Message, MessageState, RequestView, read_message,
};
use crate::file_store::transaction::save_batch_locked;

impl FileStore {
    /// An agent accepts a request, naming itself (`by`, an agent or session ID). The first
    /// acceptance is final: a second one is `request_accepted`, and a withdrawn request
    /// takes none (`request_withdrawn`).
    pub fn accept_request(
        &self,
        project: &ProjectId,
        id: &str,
        by: &str,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<RequestView, AgboardError> {
        if actor != Actor::Ai {
            return Err(AgboardError::AiOnly {
                action: "accepting a request".into(),
            });
        }
        let by = by.trim();
        if by.is_empty() || by.chars().count() > MAX_ACCEPTED_BY_CHARS {
            return Err(AgboardError::InvalidValue {
                field: "by".into(),
                reason: "Name the accepting agent in 1 to 200 characters.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut request = match read_message(shared, &project_dir, id)? {
            Message::Request(request) => request,
            Message::Question(_) => {
                return Err(AgboardError::MessageTypeMismatch {
                    id: id.to_owned(),
                    expected: "request".into(),
                });
            }
        };
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
        request.accepted_by = Some(by.to_owned());
        let message = Message::Request(request);
        let change = message_change(&project_dir, &message, false)?;
        save_batch_locked(&project_dir, vec![change])?;
        let Message::Request(request) = message else {
            unreachable!("a request")
        };
        Ok(RequestView::of(&request))
    }
}
