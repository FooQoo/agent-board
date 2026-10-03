use serde_json::json;

use crate::cli::args::AddArgs;
use crate::cli::output::card_value;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &AddArgs) -> Result<Outcome, SkanError> {
    let description = args
        .description
        .resolve(&mut std::io::stdin().lock())?
        .unwrap_or_default();
    let card = ctx
        .store
        .add_card(&args.title, &description, ctx.clock.now())?;
    Ok(Outcome {
        changed: true,
        human: format!("Added #{} to Todo: {}\n", card.id, card.title),
        json: json!({"card": card_value(&card)}),
    })
}
