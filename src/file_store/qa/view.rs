//! Messages as callers receive them: the file's fields, the derived state, and (for a
//! question) the tasks that refer to it.

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::model::{AnswerVia, Message, Question, Request, question_number};
use crate::file_store::model::Choice;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionStatus {
    Open,
    Answered,
    Withdrawn,
}

impl QuestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            QuestionStatus::Open => "open",
            QuestionStatus::Answered => "answered",
            QuestionStatus::Withdrawn => "withdrawn",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    Open,
    Accepted,
    Withdrawn,
}

impl RequestStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestStatus::Open => "open",
            RequestStatus::Accepted => "accepted",
            RequestStatus::Withdrawn => "withdrawn",
        }
    }
}

/// A reply with the label of the choice it selected.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyView {
    pub choice_id: Option<String>,
    pub choice_label: Option<String>,
    pub text: Option<String>,
    pub via: AnswerVia,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
    /// When an agent took the reply in; `null` until then.
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub accepted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionView {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub body: String,
    pub tasks: Vec<i64>,
    pub choices: Vec<Choice>,
    pub recommended_choice_id: Option<String>,
    pub reply: Option<ReplyView>,
    pub status: QuestionStatus,
    /// The unarchived tasks whose `questions` name this question, in ID order.
    pub referenced_by: Vec<i64>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub withdrawn_at: Option<DateTime<Utc>>,
}

impl QuestionView {
    pub fn of(question: &Question, referenced_by: Vec<i64>) -> Self {
        let reply = question.reply.as_ref().map(|reply| ReplyView {
            choice_id: reply.choice.clone(),
            choice_label: reply.choice.as_ref().and_then(|id| {
                question
                    .choices
                    .iter()
                    .find(|c| &c.id == id)
                    .map(|c| c.label.clone())
            }),
            text: reply.text.clone(),
            via: reply.via,
            at: reply.at,
            accepted_at: reply.accepted_at,
        });
        QuestionView {
            id: question.id.clone(),
            kind: "question",
            from: "ai",
            to: "human",
            body: question.body.clone(),
            tasks: question.tasks.clone(),
            choices: question.choices.clone(),
            recommended_choice_id: question.recommended.clone(),
            status: if question.withdrawn_at.is_some() {
                QuestionStatus::Withdrawn
            } else if question.reply.is_some() {
                QuestionStatus::Answered
            } else {
                QuestionStatus::Open
            },
            reply,
            referenced_by,
            created_at: question.created_at,
            withdrawn_at: question.withdrawn_at,
        }
    }

    pub fn number(&self) -> i64 {
        question_number(&self.id).unwrap_or(i64::MAX)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub body: String,
    pub status: RequestStatus,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub accepted_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub withdrawn_at: Option<DateTime<Utc>>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

impl RequestView {
    pub fn of(request: &Request) -> Self {
        RequestView {
            id: request.id.clone(),
            kind: "request",
            from: "human",
            to: "ai",
            body: request.body.clone(),
            status: if request.withdrawn_at.is_some() {
                RequestStatus::Withdrawn
            } else if request.accepted_at.is_some() {
                RequestStatus::Accepted
            } else {
                RequestStatus::Open
            },
            accepted_at: request.accepted_at,
            withdrawn_at: request.withdrawn_at,
            created_at: request.created_at,
        }
    }

    pub fn number(&self) -> i64 {
        question_number(&self.id).unwrap_or(i64::MAX)
    }
}

/// Either kind of message, as `show` and `ls` print it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum MessageView {
    Question(QuestionView),
    Request(RequestView),
}

impl MessageView {
    pub fn of(message: &Message, referenced_by: Vec<i64>) -> Self {
        match message {
            Message::Question(q) => MessageView::Question(QuestionView::of(q, referenced_by)),
            Message::Request(r) => MessageView::Request(RequestView::of(r)),
        }
    }

    /// The state in the words both kinds share: open, closed (answered or accepted), or
    /// withdrawn.
    pub fn state(&self) -> &'static str {
        match self {
            MessageView::Question(q) => match q.status {
                QuestionStatus::Open => "open",
                QuestionStatus::Answered => "closed",
                QuestionStatus::Withdrawn => "withdrawn",
            },
            MessageView::Request(r) => match r.status {
                RequestStatus::Open => "open",
                RequestStatus::Accepted => "closed",
                RequestStatus::Withdrawn => "withdrawn",
            },
        }
    }

    pub fn id(&self) -> &str {
        match self {
            MessageView::Question(q) => &q.id,
            MessageView::Request(r) => &r.id,
        }
    }

    pub fn number(&self) -> i64 {
        question_number(self.id()).unwrap_or(i64::MAX)
    }
}
