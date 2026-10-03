use serde_json::json;

use crate::cli::args::StateArgs;
use crate::cli::output::{card_value, state_text};
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &StateArgs) -> Result<Outcome, SkanError> {
    let (card, changed) = ctx.store.set_run_state(
        args.id,
        args.state.run_state(),
        args.reason.as_deref(),
        ctx.clock.now(),
    )?;
    let state = state_text(card.run_state, card.pending_reason.as_deref());
    // A reason runs to the end of the line; a bare state gets a period.
    let end = if card.pending_reason.is_some() {
        "\n"
    } else {
        ".\n"
    };
    let verb = if changed { "now" } else { "already" };
    let human = format!("#{} is {verb} {state}{end}", card.id);
    Ok(Outcome {
        changed,
        human,
        json: json!({"card": card_value(&card)}),
    })
}
