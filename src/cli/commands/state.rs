use crate::cli::args::StateArgs;
use crate::cli::{Context, Outcome};
use crate::{
    domain::{ChangeContext, RunState},
    error::SkanError,
    file_store::Answer,
};
use serde_json::json;

pub fn run(ctx: &mut Context, args: &StateArgs) -> Result<Outcome, SkanError> {
    let reason = args.change.resolve_reason()?;
    let state = args.state.run_state();
    let actor = args.change.actor.actor();
    let context = ChangeContext { actor, reason };
    let project_id = ctx.project_id()?;
    let current = ctx.files.card(project_id, args.id)?;
    if args.request.is_some()
        && !(current.agent_status == RunState::Pending && state == RunState::Idle)
    {
        return Err(crate::error::SkanError::InvalidArgument {
            message: "--request is only valid when answering a pending request.".into(),
            command: Some("state".into()),
        });
    }
    let (card, changed) = if current.agent_status == RunState::Pending && state == RunState::Idle {
        let request =
            args.request
                .as_deref()
                .ok_or_else(|| crate::error::SkanError::InvalidArgument {
                    message: "--request is required when answering a pending request.".into(),
                    command: Some("state".into()),
                })?;
        let answer = Answer {
            actor: context.actor,
            choice_id: None,
            text: Some(context.reason.clone()),
        };
        (
            ctx.files
                .answer_request(project_id, args.id, request, answer, ctx.clock.now())?,
            true,
        )
    } else {
        let result = ctx.files.set_agent_status(
            project_id,
            args.id,
            state,
            context,
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
