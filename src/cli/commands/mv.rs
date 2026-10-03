use serde_json::json;

use crate::cli::args::MvArgs;
use crate::cli::output::card_value;
use crate::cli::{Context, Outcome};
use crate::domain::RunState;
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &MvArgs) -> Result<Outcome, SkanError> {
    let column = args.column.column();
    // The store resets the run state itself; look first to know whether it did.
    let before = ctx.store.card(args.id)?;
    let (card, changed) = ctx.store.move_card(args.id, column, ctx.clock.now())?;
    let human = if !changed {
        format!("#{} is already in {}.\n", card.id, column.label())
    } else if before.run_state != RunState::Idle && card.run_state == RunState::Idle {
        format!(
            "Moved #{id} to {}.\n#{id} is now idle.\n",
            column.label(),
            id = card.id
        )
    } else {
        format!("Moved #{} to {}.\n", card.id, column.label())
    };
    Ok(Outcome {
        changed,
        human,
        json: json!({"card": card_value(&card)}),
    })
}
