//! The shape of `qa/<request-id>/request.json` and the states derived from it.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::Actor;
use crate::file_store::model::Choice;

/// What a question is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    /// A question asked while the plan is made.
    Plan,
    /// Approval to start the plan.
    StartApproval,
    /// A question asked while a task is worked on.
    Task,
}

impl QuestionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            QuestionKind::Plan => "plan",
            QuestionKind::StartApproval => "start_approval",
            QuestionKind::Task => "task",
        }
    }
}

/// Where an answer came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnswerVia {
    /// The board on the computer or the mobile monitor.
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

/// A recorded answer. It is never changed once written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QaAnswer {
    pub choice_id: Option<String>,
    pub choice_label: Option<String>,
    pub text: Option<String>,
    pub actor: Actor,
    pub via: AnswerVia,
    #[serde(with = "crate::clock::serde_utc")]
    pub at: DateTime<Utc>,
}

/// One question of a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QaQuestion {
    pub id: String,
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<Choice>,
    pub recommended_choice_id: Option<String>,
    pub approving_choice_ids: Vec<String>,
    pub answer: Option<QaAnswer>,
}

/// `request.json`: the questions one command registered together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QaRequestFile {
    pub format_version: u32,
    pub request_id: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    pub created_by: Actor,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub withdraw_reason: Option<String>,
    pub questions: Vec<QaQuestion>,
}

/// The state of a question, derived when it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

/// The state of a request, derived when it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    Open,
    Answered,
    Withdrawn,
}

impl QaRequestFile {
    pub fn question_status(&self, question: &QaQuestion) -> QuestionStatus {
        if question.answer.is_some() {
            QuestionStatus::Answered
        } else if self.withdrawn_at.is_some() {
            QuestionStatus::Withdrawn
        } else {
            QuestionStatus::Open
        }
    }

    pub fn status(&self) -> RequestStatus {
        if self.withdrawn_at.is_some() {
            RequestStatus::Withdrawn
        } else if self.questions.iter().all(|q| q.answer.is_some()) {
            RequestStatus::Answered
        } else {
            RequestStatus::Open
        }
    }

    pub fn answered_count(&self) -> usize {
        self.questions.iter().filter(|q| q.answer.is_some()).count()
    }
}

impl QaQuestion {
    /// A start approval answered with a choice that approves.
    pub fn is_given_approval(&self) -> bool {
        self.kind == QuestionKind::StartApproval
            && self.answer.as_ref().is_some_and(|answer| {
                answer
                    .choice_id
                    .as_ref()
                    .is_some_and(|choice| self.approving_choice_ids.contains(choice))
            })
    }

    /// An answered start approval whose choice does not approve.
    pub fn is_rejected_approval(&self) -> bool {
        self.kind == QuestionKind::StartApproval
            && self.answer.as_ref().is_some_and(|answer| {
                answer
                    .choice_id
                    .as_ref()
                    .is_none_or(|choice| !self.approving_choice_ids.contains(choice))
            })
    }
}

/// The number of a question ID (`Q-12` is 12).
pub fn question_number(id: &str) -> Option<i64> {
    let digits = id.strip_prefix("Q-")?;
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<i64>().ok().filter(|n| *n > 0)
}

/// One question as callers receive it: the question, its request, its state, and the tasks
/// that refer to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionView {
    pub id: String,
    pub request_id: String,
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<Choice>,
    pub recommended_choice_id: Option<String>,
    pub approving_choice_ids: Vec<String>,
    pub answer: Option<QaAnswer>,
    pub status: QuestionStatus,
    /// The unarchived tasks whose `questions` name this question, in ID order.
    pub referenced_by: Vec<i64>,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
    pub created_by: Actor,
    #[serde(with = "crate::clock::serde_opt_utc")]
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub withdraw_reason: Option<String>,
}

impl QuestionView {
    pub fn of(request: &QaRequestFile, question: &QaQuestion, referenced_by: Vec<i64>) -> Self {
        QuestionView {
            id: question.id.clone(),
            request_id: request.request_id.clone(),
            kind: question.kind,
            question: question.question.clone(),
            choices: question.choices.clone(),
            recommended_choice_id: question.recommended_choice_id.clone(),
            approving_choice_ids: question.approving_choice_ids.clone(),
            answer: question.answer.clone(),
            status: request.question_status(question),
            referenced_by,
            created_at: request.created_at,
            created_by: request.created_by,
            withdrawn_at: request.withdrawn_at,
            withdraw_reason: request.withdraw_reason.clone(),
        }
    }

    pub fn number(&self) -> i64 {
        question_number(&self.id).unwrap_or(i64::MAX)
    }
}
