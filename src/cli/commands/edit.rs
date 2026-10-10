use crate::cli::args::EditArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &EditArgs) -> Result<Outcome, SkanError> {
    let mut stdin = std::io::stdin();
    let description = args.description.resolve(&mut stdin)?;
    let result = ctx.files.edit_card(
        ctx.project_id()?,
        args.id,
        args.title.as_deref(),
        description.as_deref(),
        ctx.clock.now(),
    )?;
    Ok(Outcome {
        changed: result.changed,
        human: format!("Updated #{}.\n", args.id),
        json: json!({"card": result.value}),
    })
}
