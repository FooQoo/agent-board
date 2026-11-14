//! Recording answers. Several answers are written together, or none is.

use chrono::{DateTime, Utc};

use super::super::{lock_project, stamp};
use super::{broken_file_error, referrers, request_change};
use crate::domain::{Actor, ProjectId};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::model::HistoryRecord;
use crate::file_store::qa::{
    AnswerVia, QaAnswer, QaIndex, QaQuestion, QuestionStatus, QuestionView,
};
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::validate;

/// One answer as a person gives it: a choice, a text, or both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnswerItem {
    pub question_id: String,
    pub choice_id: Option<String>,
    pub text: Option<String>,
}

fn history_text(question: &QaQuestion, answer: &QaAnswer, japanese: bool) -> String {
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
        format!("{head}（{}）:\n\n{}", question.id, question.question)
    } else {
        format!("{head} ({}):\n\n{}", question.id, question.question)
    };
    if let Some(label) = &answer.choice_label {
        text.push_str(&format!("\n\n{selected}: {label}"));
    }
    if let Some(body) = &answer.text {
        text.push_str(&format!("\n\n{answered}: {body}"));
    }
    if answer.via == AnswerVia::Chat {
        text.push_str(&format!("\n\n{chat}"));
    }
    text
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
        let mut index = QaIndex::load(shared, &project_dir)?;
        let at = stamp(now);

        let mut answered = Vec::new();
        let mut withdrawn = Vec::new();
        let mut planned: Vec<(String, QaAnswer)> = Vec::new();
        for item in items {
            if planned.iter().any(|(id, _)| id == &item.question_id) {
                return Err(AgboardError::InvalidValue {
                    field: "answers".into(),
                    reason: format!("{} is answered twice.", item.question_id),
                });
            }
            let Some((request, question)) = index.find(&item.question_id) else {
                return Err(
                    broken_file_error(&index).unwrap_or(AgboardError::QuestionNotFound {
                        id: item.question_id,
                    }),
                );
            };
            match request.question_status(question) {
                QuestionStatus::Answered => answered.push(item.question_id.clone()),
                QuestionStatus::Withdrawn => withdrawn.push(item.question_id.clone()),
                QuestionStatus::Open => {}
            }
            let text = validate::normalize_answer_text(item.text.as_deref().unwrap_or(""))?;
            let choice_id = item.choice_id.filter(|c| !c.is_empty());
            if choice_id.is_none() && text.is_none() {
                return Err(AgboardError::InvalidValue {
                    field: "answer".into(),
                    reason: format!(
                        "Choose an option, write a text answer, or both for {}.",
                        item.question_id
                    ),
                });
            }
            let choice_label = match &choice_id {
                None => None,
                Some(choice) => Some(
                    question
                        .choices
                        .iter()
                        .find(|c| &c.id == choice)
                        .ok_or_else(|| AgboardError::RequestChoiceUnknown {
                            request_id: request.request_id.clone(),
                            choice_id: choice.clone(),
                        })?
                        .label
                        .clone(),
                ),
            };
            planned.push((
                item.question_id,
                QaAnswer {
                    choice_id,
                    choice_label,
                    text,
                    actor: Actor::Human,
                    via,
                    at,
                },
            ));
        }
        if !answered.is_empty() {
            return Err(AgboardError::QuestionAnswered { ids: answered });
        }
        if !withdrawn.is_empty() {
            return Err(AgboardError::QuestionWithdrawn { ids: withdrawn });
        }

        let mut touched: Vec<String> = Vec::new();
        for (id, answer) in &planned {
            for request in &mut index.requests {
                if let Some(question) = request.questions.iter_mut().find(|q| &q.id == id) {
                    question.answer = Some(answer.clone());
                    if !touched.contains(&request.request_id) {
                        touched.push(request.request_id.clone());
                    }
                }
            }
        }
        let mut changes = Vec::new();
        for request_id in &touched {
            let request = index.request(request_id).expect("touched request");
            changes.push(request_change(&project_dir, request, false)?);
        }

        let ids: Vec<String> = planned.iter().map(|(id, _)| id.clone()).collect();
        for mut referrer in referrers(shared, project, &project_dir, &ids)? {
            if referrer.task.archived_at.is_some() {
                continue;
            }
            let language = self.history_language(project, &referrer.task)?;
            for (id, answer) in &planned {
                if !referrer.questions.contains(id) {
                    continue;
                }
                let (_, question) = index.find(id).expect("planned question");
                let english = history_text(question, answer, false);
                let japanese = history_text(question, answer, true);
                referrer.task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
            }
            referrer.task.updated_at = at;
            changes.extend(super::super::save::task_pair_changes(
                shared,
                &project_dir,
                &referrer.task,
                Some(&referrer.text),
            )?);
        }
        save_batch_locked(&project_dir, changes)?;

        let snapshot = crate::file_store::reader::read_snapshot_locked(shared, project)?;
        Ok(snapshot
            .questions
            .into_iter()
            .filter(|q| ids.contains(&q.id))
            .collect())
    }
}
