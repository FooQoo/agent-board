//! Withdrawing a message: a question by an agent, a request by a person. A reply that was
//! given stays; nothing can be written to a withdrawn message afterwards.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::{message_change, referrers};
use crate::domain::{Actor, Changed, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::HistoryRecord;
use crate::file_store::qa::{Message, MessageState, MessageView, read_message};
use crate::file_store::transaction::save_batch_locked;

impl FileStore {
    /// Withdraw a message. Withdrawing it again changes nothing. A message that has its reply
    /// cannot be withdrawn. Only an agent withdraws a question and only a person a request.
    pub fn withdraw_message(
        &self,
        project: &ProjectId,
        id: &str,
        actor: Actor,
        now: DateTime<Utc>,
    ) -> Result<Changed<MessageView>, AgboardError> {
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let mut message = read_message(shared, &project_dir, id)?;
        match (&message, actor) {
            (Message::Question(_), Actor::Human) => {
                return Err(AgboardError::AiOnly {
                    action: "withdrawing a question".into(),
                });
            }
            (Message::Request(_), Actor::Ai) => {
                return Err(AgboardError::HumanOnly {
                    action: "withdrawing a request".into(),
                });
            }
            _ => {}
        }
        match message.state() {
            MessageState::Withdrawn => {
                return Ok(Changed {
                    value: view_of(self, project, id)?,
                    changed: false,
                });
            }
            MessageState::Closed => {
                return Err(AgboardError::MessageClosed { id: id.to_owned() });
            }
            MessageState::Open => {}
        }
        let at = stamp(now);
        match &mut message {
            Message::Question(q) => q.withdrawn_at = Some(at),
            Message::Request(r) => r.withdrawn_at = Some(at),
        }
        let mut changes = vec![message_change(&project_dir, &message, false)?];
        if matches!(message, Message::Question(_)) {
            let ids = [id.to_owned()];
            for mut referrer in referrers(shared, project, &project_dir, &ids)? {
                if referrer.task.archived_at.is_some() {
                    continue;
                }
                let language = self.history_language(project, &referrer.task)?;
                let english = format!("Withdrew a question ({id}).");
                let japanese = format!("質問を取り下げました（{id}）。");
                referrer.task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
                referrer.task.updated_at = at;
                changes.extend(super::super::save::task_pair_changes(
                    shared,
                    &project_dir,
                    &referrer.task,
                    Some(&referrer.text),
                )?);
            }
        }
        save_batch_locked(&project_dir, changes)?;
        Ok(Changed {
            value: view_of(self, project, id)?,
            changed: true,
        })
    }
}

/// The message as the snapshot reads it now; the caller holds the project lock.
fn view_of(store: &FileStore, project: &ProjectId, id: &str) -> Result<MessageView, AgboardError> {
    let (questions, requests) = super::read::views_locked(store.shared_dir(), project)?;
    questions
        .into_iter()
        .find(|q| q.id == id)
        .map(MessageView::Question)
        .or_else(|| {
            requests
                .into_iter()
                .find(|r| r.id == id)
                .map(MessageView::Request)
        })
        .ok_or_else(|| AgboardError::MessageNotFound { id: id.to_owned() })
}
