//! Asking questions: one file for each, their IDs, and the tasks that wait on them.

use chrono::{DateTime, Utc};

use super::super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lock_project, save_project, stamp,
    transition_event,
};
use super::send::{RequestImage, checked_images, stage_images};
use super::{message_change, options_line};
use crate::domain::{Actor, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::frontmatter::compose_questions;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::model::{Choice, HistoryRecord};
use crate::file_store::qa::{self, MAX_QUESTIONS, Message, Question, question_defect};
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::{io, layout, reader, validate};

/// One question as an agent asks it.
#[derive(Debug, Clone)]
pub struct AskQuestion {
    pub body: String,
    /// Empty for a question answered in words; otherwise 2 to 10.
    pub choices: Vec<Choice>,
    pub recommended_choice_id: Option<String>,
    /// Tasks that wait on this question only.
    pub tasks: Vec<i64>,
    /// Images stored under the question's `attachments/` folder; the body shows them as
    /// `![](attachments/<name>)`.
    pub images: Vec<RequestImage>,
}

/// The questions one `ask` registers; each becomes its own file.
#[derive(Debug, Clone)]
pub struct AskInput {
    pub actor: Actor,
    /// The board-launched session that asks (`AGBOARD_RESIDENT_ID`), recorded on each question.
    pub asked_by: Option<String>,
    pub questions: Vec<AskQuestion>,
    /// Tasks that wait on every question.
    pub tasks: Vec<i64>,
}

fn invalid(field: impl Into<String>, reason: impl Into<String>) -> AgboardError {
    AgboardError::InvalidValue {
        field: field.into(),
        reason: reason.into(),
    }
}

/// Check and normalize the questions before anything is read or written.
fn normalize(input: &AskInput) -> Result<Vec<Question>, AgboardError> {
    if input.actor != Actor::Ai {
        return Err(AgboardError::AiOnly {
            action: "asking a question".into(),
        });
    }
    if !(1..=MAX_QUESTIONS).contains(&input.questions.len()) {
        return Err(invalid("questions", "Ask 1 to 20 questions at a time."));
    }
    let mut out = Vec::new();
    for (index, asked) in input.questions.iter().enumerate() {
        let mut tasks: Vec<i64> = input.tasks.iter().chain(&asked.tasks).copied().collect();
        tasks.sort_unstable();
        tasks.dedup();
        let choices = if asked.choices.is_empty() {
            Vec::new()
        } else {
            validate::normalize_choices(asked.choices.clone())?
        };
        let question = Question {
            id: String::new(),
            body: validate::normalize_question(&asked.body)?,
            tasks,
            choices,
            recommended: asked.recommended_choice_id.clone(),
            reply: None,
            withdrawn_at: None,
            created_at: chrono::DateTime::<Utc>::UNIX_EPOCH,
            asked_by: input.asked_by.clone(),
        };
        if let Some(d) = question_defect(&question) {
            return Err(invalid(format!("questions[{index}].{}", d.field), d.reason));
        }
        out.push(question);
    }
    Ok(out)
}

impl FileStore {
    /// Ask questions: number them, publish a `QA.md` for each, and add the questions to the
    /// `questions` of the tasks named. Every file is written, or none.
    pub fn ask_questions(
        &self,
        project: &ProjectId,
        input: AskInput,
        now: DateTime<Utc>,
    ) -> Result<Vec<Question>, AgboardError> {
        let mut questions = normalize(&input)?;
        let staged_images = input
            .questions
            .iter()
            .enumerate()
            .map(|(index, asked)| {
                checked_images(&asked.images).map_err(|error| match error {
                    AgboardError::InvalidValue { field, reason } => {
                        invalid(format!("questions[{index}].{field}"), reason)
                    }
                    other => other,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let shared = self.shared_dir();
        let (project_dir, _lock) = lock_project(shared, project)?;

        // Which tasks wait on which question, in ID order.
        let mut per_task: Vec<(i64, Vec<usize>)> = Vec::new();
        for (index, asked) in input.questions.iter().enumerate() {
            for id in input.tasks.iter().chain(&asked.tasks) {
                match per_task.iter_mut().find(|(task, _)| task == id) {
                    Some((_, list)) if list.contains(&index) => {}
                    Some((_, list)) => list.push(index),
                    None => per_task.push((*id, vec![index])),
                }
            }
        }
        per_task.sort_by_key(|(id, _)| *id);
        let mut tasks = Vec::new();
        for (id, _) in &per_task {
            let task = reader::read_task_strict(shared, project, *id)?;
            if task.archived_at.is_some() {
                return Err(AgboardError::TaskArchived { id: *id });
            }
            if task.draft == Some(crate::domain::Draft::Human) {
                return Err(AgboardError::TaskIsDraft { id: *id });
            }
            ensure_ai_task_not_done(&task, input.actor)?;
            tasks.push(task);
        }

        // Numbers are reserved before the files are written, as task numbers are.
        let mut project_file = reader::read_project_file(shared, project)?;
        let first = project_file.next_question_id;
        project_file.next_question_id = first
            .checked_add(questions.len() as i64)
            .ok_or_else(|| io::write_error("project.json", "The question number overflowed."))?;
        save_project(shared, &project_dir, &project_file)?;
        for (offset, question) in questions.iter_mut().enumerate() {
            question.id = format!("Q-{}", first + offset as i64);
        }

        let at = stamp(now);
        for question in &mut questions {
            question.created_at = at;
        }
        let mut changes = Vec::new();
        for question in &questions {
            changes.push(message_change(
                &project_dir,
                &Message::Question(question.clone()),
                true,
            )?);
        }
        for (mut task, (_, indices)) in tasks.into_iter().zip(&per_task) {
            let text = reader::read_body(shared, project, task.id)?;
            let parsed = parse_task(&text, ParseMode::Stored);
            let label = layout::shared_label(
                shared,
                &layout::task_md(&layout::task_dir(&project_dir, task.id)),
            );
            if let Some(d) = parsed.questions_defects.first() {
                return Err(AgboardError::FileInvalid {
                    file: label,
                    field: d.field.clone(),
                    reason: d.reason.clone(),
                });
            }
            let mut ids = parsed.questions.clone();
            let language = self.history_language(project, &task)?;
            for index in indices {
                let question = &questions[*index];
                if !ids.contains(&question.id) {
                    ids.push(question.id.clone());
                }
                let options = options_line(&question.choices);
                let english = format!(
                    "Asked a question ({}):\n\n{}\n\nOptions: {options}",
                    question.id, question.body
                );
                let japanese = format!(
                    "質問しました（{}）:\n\n{}\n\n選択肢: {options}",
                    question.id, question.body
                );
                task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
            }
            if task.agent_status == RunState::Running {
                let listed = indices
                    .iter()
                    .map(|i| questions[*i].id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                let english = format!("Waiting for the answers to {listed}.");
                let japanese = format!("{listed} の回答を待ちます。");
                task.history.push(transition_event(Transition {
                    language,
                    kind: HistoryKind::Agent,
                    reason: Some(language.text(&english, &japanese)),
                    from_task: Some(task.task_status),
                    to_task: task.task_status,
                    from_agent: Some(RunState::Running),
                    to_agent: RunState::Idle,
                    at,
                })?);
                task.agent_status = RunState::Idle;
                task.agent_status_changed_at = at;
            }
            task.updated_at = at;
            let composed =
                compose_questions(&text, &ids).map_err(|d| AgboardError::FileInvalid {
                    file: label,
                    field: d.field,
                    reason: d.reason,
                })?;
            changes.extend(super::super::save::task_pair_changes(
                shared,
                &project_dir,
                &task,
                Some(&composed),
            )?);
        }
        let staging = stage_images(&project_dir, &staged_images)?;
        if let Err(error) = save_batch_locked(&project_dir, changes) {
            if let Some(dir) = &staging {
                let _ = std::fs::remove_dir_all(dir);
            }
            return Err(error);
        }
        if let Some(dir) = staging {
            // The question files are in place; each image folder now moves under its question
            // with one rename.
            let placed = (|| -> Result<(), AgboardError> {
                for (index, question) in questions.iter().enumerate() {
                    let from = dir.join(index.to_string());
                    if from.is_dir() {
                        let target =
                            qa::attachments_dir(&qa::message_dir(&project_dir, &question.id));
                        std::fs::rename(&from, &target)
                            .map_err(|e| io::write_error("attachments", e))?;
                    }
                }
                Ok(())
            })();
            let _ = std::fs::remove_dir_all(&dir);
            placed?;
        }
        Ok(questions)
    }
}
