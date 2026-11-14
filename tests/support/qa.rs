//! Asking and answering project questions in tests.
#![allow(dead_code)]

use agent_board::domain::{Actor, ProjectId};
use agent_board::file_store::model::Choice;
use agent_board::file_store::qa::{AnswerVia, QaRequestFile, QuestionKind};
use agent_board::file_store::{AnswerItem, AskInput, AskQuestion, FileStore};

pub fn choices(pairs: &[(&str, &str)]) -> Vec<Choice> {
    pairs
        .iter()
        .map(|(id, label)| Choice {
            id: (*id).into(),
            label: (*label).into(),
        })
        .collect()
}

/// One task question with the given choices, asked by the AI for `tasks`.
pub fn ask(
    store: &FileStore,
    project: &ProjectId,
    tasks: &[i64],
    question: &str,
    options: &[(&str, &str)],
) -> QaRequestFile {
    ask_kind(
        store,
        project,
        tasks,
        QuestionKind::Task,
        question,
        options,
        &[],
    )
}

pub fn ask_kind(
    store: &FileStore,
    project: &ProjectId,
    tasks: &[i64],
    kind: QuestionKind,
    question: &str,
    options: &[(&str, &str)],
    approving: &[&str],
) -> QaRequestFile {
    store
        .ask_questions(
            project,
            AskInput {
                actor: Actor::Ai,
                questions: vec![AskQuestion {
                    kind,
                    question: question.into(),
                    choices: choices(options),
                    recommended_choice_id: None,
                    approving_choice_ids: approving.iter().map(|s| (*s).into()).collect(),
                    tasks: Vec::new(),
                }],
                tasks: tasks.to_vec(),
            },
            chrono::Utc::now(),
        )
        .unwrap()
}

/// A person's answer through the command line.
pub fn answer(
    store: &FileStore,
    project: &ProjectId,
    id: &str,
    choice: Option<&str>,
    text: Option<&str>,
) {
    store
        .answer_questions(
            project,
            vec![AnswerItem {
                question_id: id.into(),
                choice_id: choice.map(str::to_string),
                text: text.map(str::to_string),
            }],
            AnswerVia::Cli,
            chrono::Utc::now(),
        )
        .unwrap();
}

/// One task question with the given choices, asked by the AI for one task.
pub fn ask_choices(
    store: &FileStore,
    project: &ProjectId,
    task: i64,
    question: &str,
    choices: Vec<Choice>,
) -> QaRequestFile {
    store
        .ask_questions(
            project,
            AskInput {
                actor: Actor::Ai,
                questions: vec![AskQuestion {
                    kind: QuestionKind::Task,
                    question: question.into(),
                    choices,
                    recommended_choice_id: None,
                    approving_choice_ids: Vec::new(),
                    tasks: Vec::new(),
                }],
                tasks: vec![task],
            },
            chrono::Utc::now(),
        )
        .unwrap()
}
