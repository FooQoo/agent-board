//! Registering a request: the questions, their IDs, and the tasks that wait on them.

use chrono::{DateTime, Utc};

use super::super::{
    HistoryKind, Transition, ensure_ai_task_not_done, lock_project, new_id, save_project, stamp,
    transition_event,
};
use super::{options_line, request_change};
use crate::domain::{Actor, ProjectId, RunState};
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::frontmatter::compose_questions;
use crate::file_store::history::{ParseMode, parse_task};
use crate::file_store::model::{Choice, HistoryRecord};
use crate::file_store::qa::{
    MAX_QUESTIONS, QaQuestion, QaRequestFile, QuestionKind, question_defect,
};
use crate::file_store::transaction::save_batch_locked;
use crate::file_store::{io, layout, reader, validate};

/// One question as an agent asks it.
#[derive(Debug, Clone)]
pub struct AskQuestion {
    pub kind: QuestionKind,
    pub question: String,
    pub choices: Vec<Choice>,
    pub recommended_choice_id: Option<String>,
    pub approving_choice_ids: Vec<String>,
    /// Tasks that wait on this question only.
    pub tasks: Vec<i64>,
}

/// A request to register.
#[derive(Debug, Clone)]
pub struct AskInput {
    pub actor: Actor,
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
fn normalize(input: &AskInput) -> Result<Vec<QaQuestion>, AgboardError> {
    if !(1..=MAX_QUESTIONS).contains(&input.questions.len()) {
        return Err(invalid("questions", "A request has 1 to 20 questions."));
    }
    let mut out = Vec::new();
    for (index, asked) in input.questions.iter().enumerate() {
        let question = QaQuestion {
            id: String::new(),
            kind: asked.kind,
            question: validate::normalize_question(&asked.question)?,
            choices: validate::normalize_choices(asked.choices.clone())?,
            recommended_choice_id: asked.recommended_choice_id.clone(),
            approving_choice_ids: asked.approving_choice_ids.clone(),
            answer: None,
        };
        if let Some(d) = question_defect(&question) {
            return Err(invalid(format!("questions[{index}].{}", d.field), d.reason));
        }
        out.push(question);
    }
    Ok(out)
}

impl FileStore {
    /// Register a request: number its questions, publish `request.json`, and add the questions
    /// to the `questions` of the tasks named. Every file is written, or none.
    pub fn ask_questions(
        &self,
        project: &ProjectId,
        input: AskInput,
        now: DateTime<Utc>,
    ) -> Result<QaRequestFile, AgboardError> {
        let mut questions = normalize(&input)?;
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
            if task.is_draft {
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
        let request = QaRequestFile {
            format_version: layout::FORMAT_VERSION,
            request_id: new_id()?,
            created_at: at,
            created_by: input.actor,
            withdrawn_at: None,
            withdraw_reason: None,
            questions,
        };
        let mut changes = vec![request_change(&project_dir, &request, true)?];
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
                let question = &request.questions[*index];
                if !ids.contains(&question.id) {
                    ids.push(question.id.clone());
                }
                let options = options_line(&question.choices);
                let english = format!(
                    "Asked a question ({}):\n\n{}\n\nOptions: {options}",
                    question.id, question.question
                );
                let japanese = format!(
                    "質問しました（{}）:\n\n{}\n\n選択肢: {options}",
                    question.id, question.question
                );
                task.history.push(HistoryRecord {
                    at,
                    reason: language.text(&english, &japanese).to_owned(),
                });
            }
            if task.agent_status == RunState::Running {
                let listed = indices
                    .iter()
                    .map(|i| request.questions[*i].id.as_str())
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
        save_batch_locked(&project_dir, changes)?;
        Ok(request)
    }
}
