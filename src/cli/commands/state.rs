//! `state`: a task's run state, idle or running. Questions go through `qa`.

use serde_json::json;

use crate::cli::args::{StateArgs, read_reason};
use crate::cli::{Context, Outcome};
use crate::domain::{ChangeContext, validate_work_reason};
use crate::error::AgboardError;

pub fn run(ctx: &mut Context, args: &StateArgs) -> Result<Outcome, AgboardError> {
    let state = args.state.run_state();
    let actor = args.actor.actor();
    let reason = read_reason(args.reason.as_deref(), args.reason_file.as_deref())?
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            validate_work_reason(&raw)?;
            Ok::<_, AgboardError>(raw)
        })
        .transpose()?
        .unwrap_or_default();
    let project_id = ctx.project_id()?;
    let result = ctx.files.set_agent_status(
        project_id,
        args.id,
        state,
        ChangeContext { actor, reason },
        ctx.clock.now(),
    )?;
    let human = if result.changed {
        format!("#{} agent status is now {}.\n", args.id, state.as_str())
    } else {
        format!("#{} agent status is already {}.\n", args.id, state.as_str())
    };
    Ok(Outcome {
        changed: result.changed,
        human,
        json: json!({"task": result.value}),
    })
}
