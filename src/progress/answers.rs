//! Answers no agent has taken in yet, in the progress table: an agent learns of an answer even
//! when it stopped waiting for it.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::file_store::qa::QuestionStatus;
use crate::file_store::reader::ProjectSnapshot;

/// An answered question whose answer no agent accepted. The agent reads it here, does the work,
/// and records the receipt with `message accept`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressAnswer {
    pub id: String,
    /// The first line of the question, at most `text::TITLE_LIMIT` characters.
    pub title: String,
    /// The unarchived tasks that refer to the question, in ID order.
    pub tasks: Vec<i64>,
    pub choice_id: Option<String>,
    pub choice_label: Option<String>,
    pub text: Option<String>,
    /// The absolute paths of the images the person attached to the answer.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub image_paths: Vec<std::path::PathBuf>,
    #[serde(with = "crate::clock::serde_utc")]
    pub answered_at: DateTime<Utc>,
}

/// The answers of a snapshot no agent accepted, in ID order.
pub fn unaccepted_answers(
    snapshot: &ProjectSnapshot,
    shared: &std::path::Path,
) -> Vec<ProgressAnswer> {
    let project_dir = crate::file_store::layout::project_dir(shared, &snapshot.project.id);
    snapshot
        .questions
        .iter()
        .filter(|question| question.status == QuestionStatus::Answered)
        .filter_map(|question| {
            let reply = question.reply.as_ref()?;
            reply.accepted_at.is_none().then(|| ProgressAnswer {
                id: question.id.clone(),
                title: super::text::request_title(&question.body),
                tasks: question.referenced_by.clone(),
                choice_id: reply.choice_id.clone(),
                choice_label: reply.choice_label.clone(),
                text: reply.text.clone(),
                image_paths: question
                    .clone()
                    .with_image_paths(&project_dir)
                    .reply
                    .map(|r| r.image_paths)
                    .unwrap_or_default(),
                answered_at: reply.at,
            })
        })
        .collect()
}
