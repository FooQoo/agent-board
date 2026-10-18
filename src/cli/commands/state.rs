//! `state`: a task's run state. Answering a pending request, asking one with
//! `--request-json`, and the plain run-state changes.

use std::io::Read;

use serde::Deserialize;
use serde_json::json;

use crate::agent::wait::wait_for_pending_resolution;
use crate::cli::args::{StateArgs, read_reason};
use crate::cli::{Context, Outcome};
use crate::domain::{ChangeContext, RunState, validate_work_reason};
use crate::error::{AgboardError, FileAction};
use crate::file_store::Answer;
use crate::file_store::model::Choice;

/// The JSON of `--request-json`: a question and zero to ten choices.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestFile {
    question: String,
    #[serde(default)]
    choices: Vec<Choice>,
    /// Present when the command should wait for the answer after asking.
    #[serde(default)]
    wait: Option<WaitSpec>,
}

/// How the command waits for the answer. A missing time means wait indefinitely.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WaitSpec {
    timeout_seconds: Option<u64>,
}

/// The longest wait, in seconds: a day.
const MAX_WAIT_SECS: u64 = 86_400;

/// The workflow response retained for this request ID.
fn answer_of(
    ctx: &Context,
    id: i64,
    request: &str,
) -> Result<Option<serde_json::Value>, AgboardError> {
    Ok(ctx
        .files
        .request_answer(ctx.project_id()?, id, request)?
        .map(|record| {
            json!({
                "actor": record.actor,
                "choiceId": record.choice_id,
                "choiceLabel": record.choice_label,
                "text": record.text,
            })
        }))
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
    let request: RequestFile =
        serde_json::from_str(&text).map_err(|e| AgboardError::InvalidValue {
            field: "request-json".into(),
            reason: format!("The request must be JSON with a question and 0 to 10 choices: {e}."),
        })?;
    if let Some(timeout) = request.wait.as_ref().and_then(|wait| wait.timeout_seconds)
        && !(1..=MAX_WAIT_SECS).contains(&timeout)
    {
        return Err(AgboardError::InvalidValue {
            field: "request-json".into(),
            reason: format!("wait.timeoutSeconds must be from 1 to {MAX_WAIT_SECS}."),
        });
    }
    Ok(request)
}

pub fn run(ctx: &mut Context, args: &StateArgs) -> Result<Outcome, AgboardError> {
    let state = args.state.run_state();
    let actor = args.actor.actor();
    let reason = read_reason(args.reason.as_deref(), args.reason_file.as_deref())?
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            validate_work_reason(&raw)?;
            Ok::<_, AgboardError>(raw)
        })
        .transpose()?;
    let project_id = ctx.project_id()?;
    let current = ctx.files.task(project_id, args.id)?;
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
            "A pending state needs --request-json with a question and 0 to 10 choices.",
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

    // The request is read once, before anything is saved; a wait that cannot work saves nothing.
    let request = args
        .request_json
        .as_deref()
        .map(read_request_json)
        .transpose()?;
    let wait_requested = request
        .as_ref()
        .is_some_and(|request| request.wait.is_some());
    let wait_secs = request
        .as_ref()
        .and_then(|request| request.wait.as_ref())
        .and_then(|wait| wait.timeout_seconds);
    if wait_requested {
        // The wait needs the server's event stream.
        let dir = ctx
            .files
            .shared_dir()
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf();
        let running = crate::paths::read_serve_info_in(&dir)
            .is_some_and(|info| crate::server::is_serving(&info));
        if !running {
            return Err(AgboardError::BoardUnavailable {
                reason: "A wait needs a running server. Run \"agboard serve\" first.".into(),
            });
        }
    }

    let (task, changed) = if answering {
        let request = args
            .request
            .as_deref()
            .ok_or_else(|| invalid("--request is required when answering a pending request."))?;
        let answer = Answer {
            actor,
            choice_id: args.choice.clone(),
            text: reason,
        };
        let task =
            ctx.files
                .answer_request(project_id, args.id, request, answer, ctx.clock.now())?;
        (task, true)
    } else if let Some(file) = request {
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
        let reason = reason.unwrap_or_default();
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
    if wait_requested {
        let request = task
            .pending_request_id
            .clone()
            .ok_or_else(|| invalid("The request is not pending."))?;
        // The page learns of the question now, not after the answer.
        let dir = ctx
            .files
            .shared_dir()
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf();
        crate::cli::run::after_commit(ctx, &dir);
        let project = ctx.project()?;
        let resolved = wait_for_pending_resolution(
            ctx.files.shared_dir(),
            &project.name,
            project.id.clone(),
            args.id,
            &request,
            wait_secs,
        )?;
        let answer = answer_of(ctx, args.id, &request)?;
        let note = answer
            .as_ref()
            .and_then(|a| a["choiceLabel"].as_str().map(str::to_string))
            .unwrap_or_default();
        let text = answer
            .as_ref()
            .and_then(|a| a["text"].as_str().map(str::to_string))
            .unwrap_or_default();
        return Ok(Outcome {
            changed: true,
            human: format!("#{} answered: {} {}\n", args.id, note, text).replace("  ", " "),
            json: json!({"task": resolved, "answer": answer}),
        });
    }
    let human = if changed {
        format!("#{} agent status is now {}.\n", args.id, state.as_str())
    } else {
        format!("#{} agent status is already {}.\n", args.id, state.as_str())
    };
    Ok(Outcome {
        changed,
        human,
        json: json!({"task": task}),
    })
}
