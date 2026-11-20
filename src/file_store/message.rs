//! Questions and requests in one shape.
//!
//! Lists, the band and notifications read only [`Message`]. What differs between the two
//! kinds stays inside their types; both come from a message file.

use serde::{Deserialize, Serialize};

use super::qa::{QuestionStatus, QuestionView, RequestStatus, RequestView};
use super::reader::ProjectSnapshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Question,
    Request,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Party {
    Ai,
    Human,
}

/// One item of the common shape. `turn` is who has to act; `None` means it is over.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: MessageKind,
    pub from: Party,
    pub to: Party,
    pub turn: Option<Party>,
    /// The first line of a message.
    pub title: String,
    pub created_at: String,
    pub tasks: Vec<i64>,
    pub epic_id: Option<String>,
}

/// What the two kinds have in common.
pub trait MessageSource {
    fn message(&self) -> Message;
}

/// The first non-empty line of a text as plain text, up to 200 characters: Markdown marks are removed.
pub fn title_of(body: &str) -> String {
    crate::domain::first_line_plain(body)
        .chars()
        .take(200)
        .collect()
}

pub struct Question<'a>(pub &'a QuestionView);
pub struct Request<'a>(pub &'a RequestView);

impl MessageSource for Question<'_> {
    fn message(&self) -> Message {
        let q = self.0;
        Message {
            id: q.id.clone(),
            kind: MessageKind::Question,
            from: Party::Ai,
            to: Party::Human,
            // An answer stays listed as the agent's turn until an agent accepts it.
            turn: match q.status {
                QuestionStatus::Open => Some(Party::Human),
                QuestionStatus::Answered
                    if q.reply.as_ref().is_some_and(|r| r.accepted_at.is_none()) =>
                {
                    Some(Party::Ai)
                }
                _ => None,
            },
            title: title_of(&q.body),
            created_at: crate::clock::format_utc(q.created_at),
            tasks: q.tasks.clone(),
            epic_id: None,
        }
    }
}

impl MessageSource for Request<'_> {
    fn message(&self) -> Message {
        let r = self.0;
        Message {
            id: r.id.clone(),
            kind: MessageKind::Request,
            from: Party::Human,
            to: Party::Ai,
            turn: (r.status == RequestStatus::Open).then_some(Party::Ai),
            title: title_of(&r.body),
            created_at: crate::clock::format_utc(r.created_at),
            tasks: Vec::new(),
            epic_id: None,
        }
    }
}

/// The open messages of a project, oldest first (ties by ID). Accepted and withdrawn messages
/// are left out: nothing is waiting on them, and no screen lists them. An answer no agent
/// accepted yet stays, as the agent's turn.
pub fn messages(snapshot: &ProjectSnapshot) -> Vec<Message> {
    let mut all: Vec<Message> = snapshot
        .questions
        .iter()
        .map(|q| Question(q).message())
        .chain(snapshot.requests.iter().map(|r| Request(r).message()))
        .filter(|e| e.turn.is_some())
        .collect();
    all.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
    all
}
