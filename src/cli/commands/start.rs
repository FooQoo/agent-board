//! `start`: a person starts an AI draft task.

use serde_json::json;

use crate::cli::args::StartArgs;
use crate::cli::{Context, Outcome};
use crate::error::AgboardError;

pub fn run(ctx: &mut Context, args: &StartArgs) -> Result<Outcome, AgboardError> {
    let project_id = ctx.project_id()?;
    let result = ctx
        .files
        .start_task(project_id, args.id, args.actor.actor(), ctx.clock.now())?;
    let human = if result.changed {
        format!("Started #{}.\n", args.id)
    } else {
        format!("#{} is not an AI draft.\n", args.id)
    };
    Ok(Outcome {
        changed: result.changed,
        human,
        json: json!({"task": result.value}),
    })
}
