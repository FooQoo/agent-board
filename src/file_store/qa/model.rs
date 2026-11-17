//! The messages of `qa/Q-<n>/QA.md`: a question (from an agent to a person) and a request
//! (from a person to an agent). The state is never stored; it is derived from the fields.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::file_store::model::Choice;

/// Where a reply came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerVia {
    /// The board on the computer or remote access.
    Ui,
    /// An agent wrote back the answer a person gave in its chat.
    Chat,
    /// A person answered in a terminal.
    Cli,
}

impl AnswerVia {
    pub fn as_str(self) -> &'static str {
        match self {
            AnswerVia::Ui => "ui",
            AnswerVia::Chat => "chat",
            AnswerVia::Cli => "cli",
        }
    }
}

/// A person's reply to a question. It is written once and never changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub choice: Option<String>,
    pub text: Option<String>,
    pub via: AnswerVia,
    pub at: DateTime<Utc>,
}

/// A question an agent asks a person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Question {
    pub id: String,
    /// The Markdown text of the question.
    pub body: String,
    /// The tasks the question was asked for.
    pub tasks: Vec<i64>,
    pub choices: Vec<Choice>,
    pub recommended: Option<String>,
    pub reply: Option<Reply>,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// A request a person sends an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub id: String,
    /// The Markdown text of the request.
    pub body: String,
    pub accepted_at: Option<DateTime<Utc>>,
    /// The agent or session that accepted the request.
    pub accepted_by: Option<String>,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Question(Question),
    Request(Request),
}

/// The state of a message, the same for both kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageState {
    Open,
    /// Answered (a question) or accepted (a request).
    Closed,
    Withdrawn,
}

impl MessageState {
    pub fn as_str(self) -> &'static str {
        match self {
            MessageState::Open => "open",
            MessageState::Closed => "closed",
            MessageState::Withdrawn => "withdrawn",
        }
    }
}

impl Question {
    pub fn state(&self) -> MessageState {
        if self.withdrawn_at.is_some() {
            MessageState::Withdrawn
        } else if self.reply.is_some() {
            MessageState::Closed
        } else {
            MessageState::Open
        }
    }
}

impl Request {
    pub fn state(&self) -> MessageState {
        if self.withdrawn_at.is_some() {
            MessageState::Withdrawn
        } else if self.accepted_at.is_some() {
            MessageState::Closed
        } else {
            MessageState::Open
        }
    }
}

impl Message {
    pub fn id(&self) -> &str {
        match self {
            Message::Question(q) => &q.id,
            Message::Request(r) => &r.id,
        }
    }

    pub fn body(&self) -> &str {
        match self {
            Message::Question(q) => &q.body,
            Message::Request(r) => &r.body,
        }
    }

    pub fn state(&self) -> MessageState {
        match self {
            Message::Question(q) => q.state(),
            Message::Request(r) => r.state(),
        }
    }

    pub fn created_at(&self) -> DateTime<Utc> {
        match self {
            Message::Question(q) => q.created_at,
            Message::Request(r) => r.created_at,
        }
    }

    pub fn number(&self) -> i64 {
        question_number(self.id()).unwrap_or(i64::MAX)
    }
}

/// The number of a message ID (`Q-12` is 12).
pub fn question_number(id: &str) -> Option<i64> {
    let digits = id.strip_prefix("Q-")?;
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<i64>().ok().filter(|n| *n > 0)
}
