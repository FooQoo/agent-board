//! `state`: a card's run state. Answering a pending request, asking one with
//! `--request-file`, and the plain run-state changes.

use std::path::Path;

use serde::Deserialize;
use serde_json::json;

use crate::cli::args::{StateArgs, read_reason};
use crate::cli::{Context, Outcome};
use crate::domain::{ChangeContext, RunState, validate_work_reason};
use crate::error::{AgboardError, FileAction};
use crate::file_store::Answer;
use crate::file_store::model::Choice;

/// The JSON of `--request-file`: a question and up to ten choices.
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

/// The request in `--request-file`. A file that cannot be read is `file_error`;
/// one that is not the expected JSON is `invalid_value`.
fn read_request_file(path: &Path) -> Result<RequestFile, AgboardError> {
    let text = std::fs::read_to_string(path).map_err(|e| AgboardError::FileError {
        action: FileAction::Read,
        file: path.display().to_string(),
        reason: e.to_string(),
    })?;
    serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
        field: "request-file".into(),
        reason: format!("The request file must be JSON with a question and choices: {e}."),
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
    if args.request_file.is_some() {
        if state != RunState::Pending {
            return Err(invalid(
                "--request-file is only valid with the pending state.",
            ));
        }
        if reason.is_some() {
            return Err(invalid(
                "--request-file holds the question; give no --reason with it.",
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
    } else if let Some(path) = &args.request_file {
        let file = read_request_file(path)?;
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
