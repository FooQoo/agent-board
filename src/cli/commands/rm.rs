use std::io::{BufRead, Write};

use serde_json::json;

use crate::cli::args::RmArgs;
use crate::cli::output::card_value;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &RmArgs) -> Result<Outcome, SkanError> {
    // `run.rs` does not know about terminals yet; ask here.
    ctx.interactive = ctx.interactive || confirm::is_interactive(ctx.json);
    let stdin = std::io::stdin();
    run_with_io(ctx, args, &mut stdin.lock(), &mut std::io::stderr())
}

/// Like [`run`], with the answer's source and the prompt's destination given.
/// A human can be asked only when `ctx.interactive` is set and `ctx.json` is
/// not; otherwise the command always fails with `confirmation_required`.
pub fn run_with_io(
    ctx: &Context,
    args: &RmArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    if ctx.json || !ctx.interactive {
        return Err(SkanError::ConfirmationRequired {
            operation: "deleting a card".to_string(),
        });
    }
    let card = ctx.store.card(args.id)?;
    let prompt = format!(
        "Delete #{} \"{}\"? This cannot be undone.",
        card.id, card.title
    );
    if !confirm::confirm(&prompt, input, output)? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".to_string(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.store.delete_card(card.id)?;
    Ok(Outcome {
        changed: true,
        human: format!("Deleted #{}.\n", card.id),
        json: json!({"card": card_value(&card)}),
    })
}
