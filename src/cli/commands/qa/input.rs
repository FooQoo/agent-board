//! Reading the JSON and the limits that `qa` takes on the command line.

use std::io::Read;

use serde::Deserialize;

use crate::domain::Actor;
use crate::error::{AgboardError, FileAction};
use crate::file_store::model::Choice;
use crate::file_store::qa::QuestionKind;
use crate::file_store::{AnswerItem, AskInput, AskQuestion};

/// The default wait, in seconds.
pub(super) const DEFAULT_TIMEOUT: u64 = 600;
/// The longest wait, in seconds: a day.
const MAX_TIMEOUT: u64 = 86_400;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestJson {
    questions: Vec<QuestionJson>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct QuestionJson {
    #[serde(default)]
    kind: Option<QuestionKind>,
    question: String,
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    recommended_choice_id: Option<String>,
    #[serde(default)]
    approving_choice_ids: Vec<String>,
    #[serde(default)]
    tasks: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnswersJson {
    answers: Vec<AnswerJson>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AnswerJson {
    id: String,
    #[serde(default)]
    choice_id: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

/// The value itself, or standard input when the value is `-`.
fn text_of(value: &str) -> Result<String, AgboardError> {
    if value != "-" {
        return Ok(value.to_string());
    }
    let mut text = String::new();
    std::io::stdin()
        .read_to_string(&mut text)
        .map_err(|e| AgboardError::FileError {
            action: FileAction::Read,
            file: "standard input".into(),
            reason: e.to_string(),
        })?;
    Ok(text)
}

/// The questions of `--request-json` and the tasks of `--task`.
pub(super) fn ask_input(
    value: &str,
    actor: Actor,
    tasks: &[i64],
) -> Result<AskInput, AgboardError> {
    let text = text_of(value)?;
    let request: RequestJson =
        serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
            field: "request-json".into(),
            reason: format!(
                "The request must be JSON with 1 to 20 questions, each with 2 to 10 choices: {e}."
            ),
        })?;
    Ok(AskInput {
        actor,
        tasks: tasks.to_vec(),
        questions: request
            .questions
            .into_iter()
            .map(|q| AskQuestion {
                kind: q.kind.unwrap_or(QuestionKind::Task),
                question: q.question,
                choices: q.choices,
                recommended_choice_id: q.recommended_choice_id,
                approving_choice_ids: q.approving_choice_ids,
                tasks: q.tasks,
            })
            .collect(),
    })
}

/// The answers of `--answers-json`.
pub(super) fn answer_items(value: &str) -> Result<Vec<AnswerItem>, AgboardError> {
    let text = text_of(value)?;
    let answers: AnswersJson =
        serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
            field: "answers-json".into(),
            reason: format!(
                "The answers must be JSON: {{\"answers\":[{{\"id\",\"choiceId\",\"text\"}}]}}: {e}."
            ),
        })?;
    Ok(answers
        .answers
        .into_iter()
        .map(|a| AnswerItem {
            question_id: a.id,
            choice_id: a.choice_id,
            text: a.text,
        })
        .collect())
}

/// `--timeout`: seconds from 1 to 86400, or `none` for no limit. The default is 600.
pub(super) fn timeout(value: Option<&str>) -> Result<Option<u64>, AgboardError> {
    match value {
        None => Ok(Some(DEFAULT_TIMEOUT)),
        Some("none") => Ok(None),
        Some(raw) => match raw.parse::<u64>() {
            Ok(seconds) if (1..=MAX_TIMEOUT).contains(&seconds) => Ok(Some(seconds)),
            _ => Err(AgboardError::InvalidValue {
                field: "timeout".into(),
                reason: format!(
                    "--timeout is a number of seconds from 1 to {MAX_TIMEOUT}, or none."
                ),
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_takes_seconds_or_none() {
        assert_eq!(timeout(None).unwrap(), Some(600));
        assert_eq!(timeout(Some("none")).unwrap(), None);
        assert_eq!(timeout(Some("30")).unwrap(), Some(30));
        assert!(timeout(Some("0")).is_err());
        assert!(timeout(Some("86401")).is_err());
    }

    #[test]
    fn a_question_without_kind_is_a_task_question() {
        let input = ask_input(
            r#"{"questions":[{"question":"Q?","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"tasks":[3]}]}"#,
            Actor::Ai,
            &[1],
        )
        .unwrap();
        assert_eq!(input.questions[0].kind, QuestionKind::Task);
        assert_eq!(input.questions[0].tasks, vec![3]);
        assert_eq!(input.tasks, vec![1]);
    }
}
