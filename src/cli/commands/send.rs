//! `send`: send a Backlog plan to Todo.

use serde_json::json;

use crate::cli::args::SendArgs;
use crate::cli::{Context, Outcome};
use crate::domain::Actor;
use crate::error::AgboardError;

/// Only a person can confirm a warning; `--force` from an agent is refused.
pub(super) fn ack_of(actor: Actor, force: bool) -> Result<bool, AgboardError> {
    if force && actor == Actor::Ai {
        return Err(AgboardError::HumanOnly {
            action: "confirming a send with open questions (--force)".into(),
        });
    }
    Ok(force)
}

pub fn run(ctx: &mut Context, args: &SendArgs) -> Result<Outcome, AgboardError> {
    let project_id = ctx.project_id()?;
    let actor = args.actor.actor();
    let ack = ack_of(actor, args.force)?;
    let result = ctx
        .files
        .send_task(project_id, args.id, actor, ack, ctx.clock.now())?;
    let human = if result.changed {
        format!("Sent #{} to Todo.\n", args.id)
    } else {
        format!("#{} is not in the Backlog; nothing changed.\n", args.id)
    };
    Ok(Outcome {
        changed: result.changed,
        human,
        json: json!({"task": result.value}),
    })
}
