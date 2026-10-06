use crate::cli::args::ShowArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;
use serde_json::json;

pub fn run(ctx: &mut Context, args: &ShowArgs) -> Result<Outcome, SkanError> {
    let card = ctx.store.card(ctx.project_id()?, args.id)?;
    let human = crate::cli::output::show_text(&card);
    Ok(Outcome {
        changed: false,
        human,
        json: json!({"card": card}),
    })
}
