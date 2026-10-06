use crate::cli::args::RmArgs;
use crate::cli::{Context, Outcome};
use crate::{error::SkanError, interact::confirm};
use serde_json::json;
use std::io::{BufRead, Write};

pub fn run(ctx: &mut Context, args: &RmArgs) -> Result<Outcome, SkanError> {
    ctx.interactive |= confirm::is_interactive(ctx.json);
    run_with_io(
        ctx,
        args,
        &mut std::io::stdin().lock(),
        &mut std::io::stderr(),
    )
}

pub fn run_with_io(
    ctx: &Context,
    args: &RmArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    let project_id = ctx.project_id()?;
    let card = ctx.store.card(project_id, args.id)?;
    if ctx.json || !ctx.interactive {
        return Err(SkanError::ConfirmationRequired {
            operation: "deleting a card".into(),
        });
    }
    if !confirm::confirm(
        &format!("Delete #{} {}? This cannot be undone.", card.id, card.title),
        input,
        output,
    )? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".into(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.store.delete_card(project_id, args.id)?;
    Ok(Outcome {
        changed: true,
        human: format!("Deleted #{}.\n", args.id),
        json: json!({"deleted": args.id}),
    })
}
