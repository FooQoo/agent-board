use crate::cli::args::{HistoryArgs, HistoryCommand, read_reason};
use crate::cli::{Context, Outcome};
use crate::error::AgboardError;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &HistoryArgs) -> Result<Outcome, AgboardError> {
    let HistoryCommand::Add(args) = &args.command;
    let reason = read_reason(args.reason.as_deref(), args.reason_file.as_deref())?;
    let card = ctx.files.add_history(
        ctx.project_id()?,
        args.id,
        reason.as_deref(),
        ctx.clock.now(),
    )?;
    Ok(Outcome {
        changed: true,
        human: format!("Added history to #{}.\n", args.id),
        json: json!({"card": card}),
    })
}
