use crate::cli::args::ShowArgs;
use crate::cli::{Context, Outcome};
use crate::error::AgboardError;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &ShowArgs) -> Result<Outcome, AgboardError> {
    let task = ctx.files.task(ctx.project_id()?, args.id)?;
    let human = crate::cli::output::show_text(&task);
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"task": task}),
    })
}
