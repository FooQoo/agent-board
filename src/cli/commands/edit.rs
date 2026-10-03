use serde_json::json;

use crate::cli::args::EditArgs;
use crate::cli::output::card_value;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &EditArgs) -> Result<Outcome, SkanError> {
    let description = args.description.resolve(&mut std::io::stdin().lock())?;
    let (card, changed) = ctx.store.edit_card(
        args.id,
        args.title.as_deref(),
        description.as_deref(),
        ctx.clock.now(),
    )?;
    let human = if changed {
        format!("Updated #{}.\n", card.id)
    } else {
        format!("#{} is unchanged.\n", card.id)
    };
    Ok(Outcome {
        changed,
        human,
        json: json!({"card": card_value(&card)}),
    })
}
