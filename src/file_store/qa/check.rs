//! Checks of a stored `request.json`. A file with a defect is left out of every list.

use std::collections::HashSet;

use super::model::{QaQuestion, QaRequestFile, QuestionKind, question_number};
use crate::domain::Actor;
use crate::file_store::model::Choice;
use crate::file_store::validate::{
    Defect, choice_defect, is_hex32, normalize_answer_text, normalize_question,
};

/// The most questions one request holds.
pub const MAX_QUESTIONS: usize = 20;
/// The most characters of a withdrawal reason.
pub const MAX_WITHDRAW_REASON_CHARS: usize = 2_000;

fn defect(field: impl Into<String>, reason: impl Into<String>) -> Defect {
    Defect {
        field: field.into(),
        reason: reason.into(),
    }
}

/// The defects of the parts of a question that its asker supplies (no answer).
pub fn question_defect(question: &QaQuestion) -> Option<Defect> {
    if normalize_question(&question.question).ok().as_deref() != Some(question.question.as_str()) {
        return Some(defect(
            "question",
            "Questions must be 1 to 5000 characters.",
        ));
    }
    if let Some(d) = choice_defect(&question.choices) {
        return Some(d);
    }
    let known = |id: &String| question.choices.iter().any(|c| &c.id == id);
    if question
        .recommended_choice_id
        .as_ref()
        .is_some_and(|id| !known(id))
    {
        return Some(defect(
            "recommendedChoiceId",
            "The recommended choice must be one of the choices.",
        ));
    }
    if question.kind == QuestionKind::StartApproval {
        if question.approving_choice_ids.is_empty() {
            return Some(defect(
                "approvingChoiceIds",
                "A start approval needs at least one approving choice.",
            ));
        }
    } else if !question.approving_choice_ids.is_empty() {
        return Some(defect(
            "approvingChoiceIds",
            "Only a start approval has approving choices.",
        ));
    }
    let mut seen = HashSet::new();
    if question
        .approving_choice_ids
        .iter()
        .any(|id| !known(id) || !seen.insert(id))
    {
        return Some(defect(
            "approvingChoiceIds",
            "Approving choices must be distinct choices of the question.",
        ));
    }
    None
}

fn answer_defect(question: &QaQuestion) -> Option<Defect> {
    let answer = question.answer.as_ref()?;
    if answer.actor != Actor::Human {
        return Some(defect(
            "answer.actor",
            "Answers are recorded for people only.",
        ));
    }
    match (&answer.choice_id, &answer.choice_label) {
        (None, None) => {}
        (Some(id), Some(label)) => {
            let found: Option<&Choice> = question.choices.iter().find(|c| &c.id == id);
            if found.is_none_or(|c| &c.label != label) {
                return Some(defect(
                    "answer.choiceLabel",
                    "The selected choice must be one of the question's choices.",
                ));
            }
        }
        _ => {
            return Some(defect(
                "answer.choiceLabel",
                "A selected choice needs its ID and label.",
            ));
        }
    }
    if answer
        .text
        .as_deref()
        .is_some_and(|text| normalize_answer_text(text).ok().flatten().as_deref() != Some(text))
    {
        return Some(defect(
            "answer.text",
            "Answer text must be nonblank and within its limit.",
        ));
    }
    if answer.choice_id.is_none() && answer.text.is_none() {
        return Some(defect("answer", "An answer needs a choice or text."));
    }
    None
}

/// Every defect of a request file whose folder is `folder_id`.
pub fn check_request(file: &QaRequestFile, folder_id: &str) -> Vec<Defect> {
    let mut out = Vec::new();
    if !is_hex32(&file.request_id) || file.request_id != folder_id {
        out.push(defect(
            "requestId",
            "The request ID must be 32 lowercase hexadecimal characters and match its folder.",
        ));
    }
    if file.withdrawn_at.is_none() && file.withdraw_reason.is_some() {
        out.push(defect(
            "withdrawReason",
            "Only a withdrawn request has a reason.",
        ));
    }
    if let Some(reason) = &file.withdraw_reason {
        let count = reason.trim().chars().count();
        if count == 0 || count > MAX_WITHDRAW_REASON_CHARS {
            out.push(defect(
                "withdrawReason",
                "Reasons must be 1 to 2000 characters.",
            ));
        }
    }
    if !(1..=MAX_QUESTIONS).contains(&file.questions.len()) {
        out.push(defect("questions", "A request has 1 to 20 questions."));
    }
    let mut ids = HashSet::new();
    for (index, question) in file.questions.iter().enumerate() {
        if question_number(&question.id).is_none() || !ids.insert(question.id.as_str()) {
            out.push(defect(
                format!("questions[{index}].id"),
                "Question IDs are unique Q-<positive integer> values.",
            ));
        }
        if let Some(d) = question_defect(question).or_else(|| answer_defect(question)) {
            out.push(defect(format!("questions[{index}].{}", d.field), d.reason));
        }
    }
    out
}
