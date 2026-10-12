//! `state`: a card's run state. Answering a pending request, asking one with
//! `--request-json`, and the plain run-state changes.

use std::io::Read;

use serde::Deserialize;
use serde_json::json;

use crate::cli::args::{StateArgs, read_reason};
use crate::cli::{Context, Outcome};
use crate::domain::{ChangeContext, RunState, validate_work_reason};
use crate::error::{AgboardError, FileAction};
use crate::file_store::Answer;
use crate::file_store::model::Choice;

/// The JSON of `--request-json`: a question and two to ten choices.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestFile {
    question: String,
    #[serde(default)]
    choices: Vec<Choice>,
}

fn invalid(message: &str) -> AgboardError {
    AgboardError::InvalidArgument {
        message: message.into(),
        command: Some("state".into()),
    }
}

/// The request in `--request-json`, or on standard input when the value is `-`.
/// Standard input that cannot be read is `file_error`; JSON that is not the
/// expected shape is `invalid_value`.
fn read_request_json(value: &str) -> Result<RequestFile, AgboardError> {
    let text = if value == "-" {
        let mut text = String::new();
        std::io::stdin()
            .read_to_string(&mut text)
            .map_err(|e| AgboardError::FileError {
                action: FileAction::Read,
                file: "standard input".into(),
                reason: e.to_string(),
            })?;
        text
    } else {
        value.to_string()
    };
    serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
        field: "request-json".into(),
        reason: format!("The request must be JSON with a question and 2 to 10 choices: {e}."),
    })
}

pub fn run(ctx: &mut Context, args: &StateArgs) -> Result<Outcome, AgboardError> {
    let state = args.state.run_state();
    let actor = args.actor.actor();
    let reason = read_reason(args.reason.as_deref(), args.reason_file.as_deref())?
        .map(|raw| validate_work_reason(&raw))
        .transpose()?;
    let project_id = ctx.project_id()?;
    let current = ctx.files.card(project_id, args.id)?;
    let answering = current.agent_status == RunState::Pending && state == RunState::Idle;

    if args.request.is_some() && !answering {
        return Err(invalid(
            "--request is only valid when answering a pending request.",
        ));
    }
    if args.choice.is_some() && !answering {
        return Err(invalid(
            "--choice is only valid when answering a pending request.",
        ));
    }
    if state == RunState::Pending && !answering && args.request_json.is_none() {
        return Err(invalid(
            "A pending state needs --request-json with a question and 2 to 10 choices.",
        ));
    }
    if args.request_json.is_some() {
        if state != RunState::Pending {
            return Err(invalid(
                "--request-json is only valid with the pending state.",
            ));
        }
        if reason.is_some() {
            return Err(invalid(
                "--request-json holds the question; give no --reason with it.",
            ));
        }
    }

    let (card, changed) = if answering {
        let request = args
            .request
            .as_deref()
            .ok_or_else(|| invalid("--request is required when answering a pending request."))?;
        let answer = Answer {
            actor,
            choice_id: args.choice.clone(),
            text: reason,
        };
        let card =
            ctx.files
                .answer_request(project_id, args.id, request, answer, ctx.clock.now())?;
        (card, true)
    } else if let Some(value) = &args.request_json {
        let file = read_request_json(value)?;
        let result = ctx.files.request_decision(
            project_id,
            args.id,
            actor,
            &file.question,
            file.choices,
            ctx.clock.now(),
        )?;
        (result.value, result.changed)
    } else {
        let reason = reason
            .ok_or_else(|| invalid("--reason or --reason-file is required for this run state."))?;
        let result = ctx.files.set_agent_status(
            project_id,
            args.id,
            state,
            ChangeContext { actor, reason },
            None,
            ctx.clock.now(),
        )?;
        (result.value, result.changed)
    };
    let human = if changed {
        format!("#{} agent status is now {}.\n", args.id, state.as_str())
    } else {
        format!("#{} agent status is already {}.\n", args.id, state.as_str())
    };
    Ok(Outcome {
        changed,
        human,
        json: json!({"card": card}),
    })
}
