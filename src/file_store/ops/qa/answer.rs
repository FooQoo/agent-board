//! Recording answers. Several answers are written together, or none is.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::answer_images::{existing_name, place_images, remove_placed};
use super::read::views_locked;
use super::send::{RequestImage, checked_images};
use super::{broken_file_error, message_change, referrers};
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::HistoryRecord;
use crate::file_store::qa::{
    self, AnswerVia, Message, MessageState, QaIndex, Question, QuestionView, Reply,
};
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::validate;

/// One answer as a person gives it: a choice, a text, or both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnswerItem {
    pub question_id: String,
    pub choice_id: Option<String>,
    pub text: Option<String>,
    /// Images stored under the question's `attachments/` folder, checked like the images of a
    /// request.
    pub images: Vec<RequestImage>,
}

fn history_text(question: &Question, reply: &Reply, japanese: bool) -> String {
    let (head, selected, answered, chat) = if japanese {
        (
            "質問に回答しました",
            "選択",
            "回答",
            "チャットで受けた回答です。",
        )
    } else {
        (
            "Answered a question",
            "Selected",
            "Answer",
            "The answer was given in the chat.",
        )
    };
    let mut text = if japanese {
        format!("{head}（{}）:\n\n{}", question.id, question.body)
    } else {
        format!("{head} ({}):\n\n{}", question.id, question.body)
    };
    let label = reply.choice.as_ref().and_then(|id| {
        question
            .choices
            .iter()
            .find(|c| &c.id == id)
            .map(|c| c.label.as_str())
    });
    if let Some(label) = label {
        text.push_str(&format!("\n\n{selected}: {label}"));
    }
    if let Some(body) = &reply.text {
        text.push_str(&format!("\n\n{answered}: {body}"));
    }
    if !reply.images.is_empty() {
        let label = if japanese { "添付画像" } else { "Images" };
        text.push_str(&format!("\n\n{label}: {}", reply.images.join(", ")));
    }
    if reply.via == AnswerVia::Chat {
        text.push_str(&format!("\n\n{chat}"));
    }
    text
}

/// The question as it is after `item` answers it, or the reason it cannot be answered.
fn answered(
    question: &Question,
    item: &AnswerItem,
    image_names: Vec<String>,
    via: AnswerVia,
    at: DateTime<Utc>,
) -> Result<Question, AgboardError> {
    let text = validate::normalize_answer_text(item.text.as_deref().unwrap_or(""))?;
    let choice = item.choice_id.clone().filter(|c| !c.is_empty());
    if let Some(id) = &choice
        && !question.choices.iter().any(|c| &c.id == id)
    {
        return Err(AgboardError::ChoiceUnknown {
            question_id: question.id.clone(),
            choice_id: id.clone(),
        });
    }
    if !question.choices.is_empty() && choice.is_none() && text.is_none() {
        return Err(AgboardError::InvalidValue {
            field: "choice".into(),
            reason: format!(
                "Choose one of the options of {} or write a note.",
                question.id
            ),
        });
    }
    if question.choices.is_empty() && text.is_none() {
        return Err(AgboardError::InvalidValue {
            field: "text".into(),
            reason: format!("{} has no options; write the answer in words.", question.id),
        });
    }
    let mut next = question.clone();
    next.reply = Some(Reply {
        choice,
        text,
        images: image_names,
        via,
        at,
        // An answer from the chat is written by the agent that was told it: it has it already.
        accepted_at: (via == AnswerVia::Chat).then_some(at),
    });
    Ok(next)
}

impl FileStore {
    /// Record the answers of a person. Every answer is checked first; when any question is
    /// unknown, answered before, or withdrawn, nothing is written. The first recorded answer
    /// of a question is final.
    pub fn answer_questions(
        &self,
        project: &ProjectId,
        items: Vec<AnswerItem>,
        via: AnswerVia,
        now: DateTime<Utc>,
    ) -> Result<Vec<QuestionView>, AgboardError> {
        if items.is_empty() {
            return Err(AgboardError::InvalidValue {
                field: "answers".into(),
                reason: "Give at least one answer.".into(),
            });
        }
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;
        let index = QaIndex::load(shared, &project_dir)?;
        let at = stamp(now);

        // Every image is checked before anything is written.
        let mut staged: Vec<Vec<(String, &Vec<u8>)>> = Vec::new();
        for item in &items {
            staged.push(checked_images(&item.images)?);
        }
        let mut done = Vec::new();
        let mut withdrawn = Vec::new();
        let mut planned: Vec<(Question, Question)> = Vec::new();
        for (item, files) in items.iter().zip(&staged) {
            if planned.iter().any(|(old, _)| old.id == item.question_id) {
                return Err(AgboardError::InvalidValue {
                    field: "answers".into(),
                    reason: format!("{} is answered twice.", item.question_id),
                });
            }
            let question = match index.find(&item.question_id) {
                Some(Message::Question(q)) => q,
                Some(Message::Request(_)) => {
                    return Err(AgboardError::MessageTypeMismatch {
                        id: item.question_id.clone(),
                        expected: "question".into(),
                    });
                }
                None => {
                    return Err(broken_file_error(&index).unwrap_or(
                        AgboardError::MessageNotFound {
                            id: item.question_id.clone(),
                        },
                    ));
                }
            };
            match question.state() {
                MessageState::Closed => done.push(question.id.clone()),
                MessageState::Withdrawn => withdrawn.push(question.id.clone()),
                MessageState::Open => {}
            }
            let names = files.iter().map(|(name, _)| name.clone()).collect();
            let attachments = qa::attachments_dir(&qa::message_dir(&project_dir, &question.id));
            for (name, _) in files {
                // An answer never replaces an image the question already holds.
                if existing_name(&attachments, name) {
                    return Err(AgboardError::InvalidValue {
                        field: "image".into(),
                        reason: format!(
                            "{} already has an image named {name}; rename the new one.",
                            question.id
                        ),
                    });
                }
            }
            planned.push((question.clone(), answered(question, item, names, via, at)?));
        }
        if !done.is_empty() {
            return Err(AgboardError::QuestionAnswered { ids: done });
        }
        if !withdrawn.is_empty() {
            return Err(AgboardError::QuestionWithdrawn { ids: withdrawn });
        }

        let mut placed = Vec::new();
        if let Err(error) = place_images(&project_dir, &planned, &staged, &mut placed) {
            remove_placed(&placed);
            return Err(error);
        }
        match self.record_answers(shared, project, &project_dir, &planned, at) {
            Ok(ids) => {
                let (questions, _) = views_locked(shared, project)?;
                Ok(questions
                    .into_iter()
                    .filter(|q| ids.contains(&q.id))
                    .collect())
            }
            Err(error) => {
                remove_placed(&placed);
                Err(error)
            }
        }
    }

    /// Save the answers and the history of the tasks that refer to them as one batch.
    fn record_answers(
        &self,
        shared: &std::path::Path,
        project: &ProjectId,
        project_dir: &std::path::Path,
        planned: &[(Question, Question)],
        at: DateTime<Utc>,
    ) -> Result<Vec<String>, AgboardError> {
        let mut changes = Vec::new();
        for (_, next) in planned {
            changes.push(message_change(
                project_dir,
                &Message::Question(next.clone()),
                false,
            )?);
        }

        let ids: Vec<String> = planned.iter().map(|(q, _)| q.id.clone()).collect();
        for mut referrer in referrers(shared, project, project_dir, &ids)? {
            if referrer.task.archived_at.is_some() {
                continue;
            }
            let language = self.history_language(project, &referrer.task)?;
            for (_, next) in planned {
                if !referrer.questions.contains(&next.id) {
                    continue;
                }
                let reply = next.reply.as_ref().expect("an answered question");
                let english = history_text(next, reply, false);
                let japanese = history_text(next, reply, true);
                referrer.task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
            }
            referrer.task.updated_at = at;
            changes.extend(super::super::save::task_pair_changes(
                shared,
                project_dir,
                &referrer.task,
                Some(&referrer.text),
            )?);
        }
        save_batch_locked(project_dir, changes)?;
        Ok(ids)
    }
}
