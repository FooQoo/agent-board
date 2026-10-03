use serde_json::json;

use crate::cli::args::ShowArgs;
use crate::cli::output::{card_value, show_text};
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &ShowArgs) -> Result<Outcome, SkanError> {
    let card = ctx.store.card(args.id)?;
    Ok(Outcome {
        changed: false,
        human: show_text(&card),
        json: json!({"card": card_value(&card)}),
    })
}
