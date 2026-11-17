//! The rules of a stored `QA.md`. A file with a defect is left out of every list.

use std::collections::HashSet;

use super::model::{Message, Question, Request, question_number};
use crate::file_store::validate::{Defect, choice_defect};

/// The most questions one `ask` registers.
pub const MAX_QUESTIONS: usize = 20;
/// The most characters of a question's text.
pub const MAX_QUESTION_CHARS: usize = 5_000;
/// The most characters of a request's text.
pub const MAX_REQUEST_CHARS: usize = 20_000;
/// The most characters of a text reply.
pub const MAX_REPLY_CHARS: usize = 2_000;

fn defect(field: &str, reason: &str) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

fn body_defect(body: &str, limit: usize) -> Option<Defect> {
    let count = body.trim().chars().count();
    (count == 0 || count > limit).then(|| {
        defect(
            "body",
            &format!("The text must be 1 to {limit} characters."),
        )
    })
}

/// The defects of the parts of a question that its asker supplies (no reply).
pub fn question_defect(question: &Question) -> Option<Defect> {
    if let Some(d) = body_defect(&question.body, MAX_QUESTION_CHARS) {
        return Some(d);
    }
    if !question.choices.is_empty()
        && let Some(d) = choice_defect(&question.choices)
    {
        return Some(d);
    }
    if let Some(id) = &question.recommended
        && !question.choices.iter().any(|c| &c.id == id)
    {
        return Some(defect(
            "recommended",
            "The recommended choice must be one of the choices.",
        ));
    }
    let mut seen = HashSet::new();
    if question.tasks.iter().any(|id| *id < 1 || !seen.insert(id)) {
        return Some(defect("tasks", "Tasks are distinct positive task numbers."));
    }
    None
}

fn reply_defect(question: &Question) -> Option<Defect> {
    let reply = question.reply.as_ref()?;
    if question.choices.is_empty() {
        if reply.choice.is_some() {
            return Some(defect(
                "reply.choice",
                "A question without choices takes no choice.",
            ));
        }
    } else {
        match &reply.choice {
            None => {
                return Some(defect(
                    "reply.choice",
                    "A question with choices needs a choice.",
                ));
            }
            Some(id) if !question.choices.iter().any(|c| &c.id == id) => {
                return Some(defect(
                    "reply.choice",
                    "The choice must be one of the question's choices.",
                ));
            }
            Some(_) => {}
        }
    }
    match &reply.text {
        Some(text) => {
            let count = text.chars().count();
            if text.trim() != text || count == 0 || count > MAX_REPLY_CHARS {
                return Some(defect("reply.text", "The text is 1 to 2000 characters."));
            }
        }
        None if question.choices.is_empty() => {
            return Some(defect(
                "reply.text",
                "A question without choices needs a text.",
            ));
        }
        None => {}
    }
    None
}

fn request_defect(request: &Request) -> Option<Defect> {
    if let Some(d) = body_defect(&request.body, MAX_REQUEST_CHARS) {
        return Some(d);
    }
    None
}

/// The first defect of a message whose folder is `folder_id`.
pub fn check_message(message: &Message, folder_id: &str) -> Option<Defect> {
    if question_number(message.id()).is_none() || message.id() != folder_id {
        return Some(defect("id", "The folder of a message is named Q-<n>."));
    }
    match message {
        Message::Question(q) => question_defect(q).or_else(|| {
            reply_defect(q).or_else(|| {
                (q.reply.is_some() && q.withdrawn_at.is_some())
                    .then(|| defect("withdrawnAt", "A question with a reply is not withdrawn."))
            })
        }),
        Message::Request(r) => request_defect(r).or_else(|| {
            (r.accepted_at.is_some() && r.withdrawn_at.is_some())
                .then(|| defect("withdrawnAt", "An accepted request is not withdrawn."))
        }),
    }
}
