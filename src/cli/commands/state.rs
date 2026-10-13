//! `state`: a card's run state. Answering a pending request, asking one with
//! `--request-json`, and the plain run-state changes.

use std::io::Read;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;

use crate::cli::args::{StateArgs, read_reason};
use crate::cli::{Context, Outcome};
use crate::domain::{ChangeContext, RunState, validate_work_reason};
use crate::error::{AgboardError, FileAction};
use crate::file_store::Answer;
use crate::file_store::model::{CardView, Choice, HistoryKind};

/// The JSON of `--request-json`: a question and two to ten choices.
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

/// Wait until request `request` of card `id` is answered or withdrawn, and return the card then. A
/// wait-command timeout is `wait_timeout`; a request that a move took back is `request_changed`.
/// Neither ending expires or otherwise changes the question. This uses the same event stream as
/// `agboard wait`, so it needs a running `agboard serve`.
fn wait_for_resolution(
    ctx: &Context,
    id: i64,
    request: &str,
    timeout_secs: Option<u64>,
) -> Result<CardView, AgboardError> {
    let project = ctx.project()?;
    let (name, project_id) = (project.name.clone(), project.id.clone());
    let shared = ctx.files.shared_dir().to_path_buf();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AgboardError::BoardUnavailable {
            reason: error.to_string(),
        })?;
    let deadline = timeout_secs.map(|seconds| Instant::now() + Duration::from_secs(seconds));
    loop {
        let snapshot = ctx.files.board(&project_id)?;
        let card = ctx.files.card(&project_id, id)?;
        if card.pending_request_id.as_deref() != Some(request) {
            let answered = card
                .history
                .iter()
                .any(|h| h.kind == HistoryKind::Answer && h.request_id.as_deref() == Some(request));
            return if answered {
                Ok(card)
            } else {
                Err(AgboardError::RequestChanged)
            };
        }
        let remaining = deadline.map(|deadline| deadline.saturating_duration_since(Instant::now()));
        if remaining.is_some_and(|remaining| remaining.is_zero()) {
            return Err(AgboardError::WaitTimeout);
        }
        runtime.block_on(crate::agent::wait::wait_for_change(
            &shared,
            &name,
            snapshot.cursor.clone(),
            remaining.map(|remaining| remaining.as_secs().max(1)),
        ))?;
    }
}

/// The answer to `request`, as the card's history records it.
fn answer_of(card: &CardView, request: &str) -> Option<serde_json::Value> {
    let record = card
        .history
        .iter()
        .rev()
        .find(|h| h.kind == HistoryKind::Answer && h.request_id.as_deref() == Some(request))?;
    Some(json!({
        "actor": record.actor,
        "choiceId": record.choice_id,
        "choiceLabel": record.choice_label,
        "text": record.reason,
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
            reason: format!("The request must be JSON with a question and 2 to 10 choices: {e}."),
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
    if wait_requested {
        let request = card
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
        let resolved = wait_for_resolution(ctx, args.id, &request, wait_secs)?;
        let answer = answer_of(&resolved, &request);
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
            json: json!({"card": resolved, "answer": answer}),
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
        json: json!({"card": card}),
    })
}
