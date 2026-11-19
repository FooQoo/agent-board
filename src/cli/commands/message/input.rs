//! Reading the JSON and the limits that `message` takes on the command line.

use std::io::Read;

use serde::Deserialize;

use crate::domain::Actor;
use crate::error::{AgboardError, FileAction};
use crate::file_store::model::Choice;
use crate::file_store::{AskInput, AskQuestion};

/// The default wait, in seconds.
pub(super) const DEFAULT_TIMEOUT: u64 = 600;
/// The longest wait, in seconds: a day.
const MAX_TIMEOUT: u64 = 86_400;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionsJson {
    questions: Vec<QuestionJson>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct QuestionJson {
    body: String,
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    recommended_choice_id: Option<String>,
    #[serde(default)]
    tasks: Vec<i64>,
}

/// The value itself, or standard input when the value is `-`.
pub(super) fn text_of(value: &str) -> Result<String, AgboardError> {
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

/// The questions of `--questions-json` and the tasks of `--task`.
pub(super) fn ask_input(
    value: &str,
    actor: Actor,
    tasks: &[i64],
) -> Result<AskInput, AgboardError> {
    let text = text_of(value)?;
    let parsed: QuestionsJson =
        serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
            field: "questions-json".into(),
            reason: format!(
                "The questions must be JSON with 1 to 20 questions, each with a body and, if it has choices, 2 to 10 of them: {e}."
            ),
        })?;
    Ok(AskInput {
        actor,
        // A board-launched session is told apart by the launch ID the launcher gave it.
        asked_by: std::env::var("AGBOARD_RESIDENT_ID")
            .ok()
            .filter(|id| !id.is_empty()),
        tasks: tasks.to_vec(),
        questions: parsed
            .questions
            .into_iter()
            .map(|q| AskQuestion {
                body: q.body,
                choices: q.choices,
                recommended_choice_id: q.recommended_choice_id,
                tasks: q.tasks,
            })
            .collect(),
    })
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
    fn questions_take_a_body_and_optional_choices_and_tasks() {
        let input = ask_input(
            r#"{"questions":[{"body":"Q?","choices":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"tasks":[3]},{"body":"Why?"}]}"#,
            Actor::Ai,
            &[1],
        )
        .unwrap();
        assert_eq!(input.questions.len(), 2);
        assert_eq!(input.questions[0].tasks, vec![3]);
        assert!(input.questions[1].choices.is_empty());
        assert_eq!(input.tasks, vec![1]);
    }

    #[test]
    fn the_old_question_keys_are_refused() {
        for json in [
            r#"{"questions":[{"question":"Q?"}]}"#,
            r#"{"questions":[{"body":"Q?","kind":"plan"}]}"#,
            r#"{"questions":[{"body":"Q?","approvingChoiceIds":["a"]}]}"#,
        ] {
            assert!(ask_input(json, Actor::Ai, &[]).is_err(), "{json}");
        }
    }
}
