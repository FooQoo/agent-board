use std::io::{BufRead, Write};

use serde_json::json;

use crate::cli::args::InitArgs;
use crate::cli::{Context, Outcome};
use crate::domain::validate_board_name;
use crate::error::SkanError;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &InitArgs) -> Result<Outcome, SkanError> {
    // `run.rs` does not know about terminals yet; ask here.
    ctx.interactive = ctx.interactive || confirm::is_interactive(ctx.json);
    let stdin = std::io::stdin();
    run_with_io(ctx, args, &mut stdin.lock(), &mut std::io::stderr())
}

/// Like [`run`], with the answer's source and the prompt's destination given.
/// A human can be asked only when `ctx.interactive` is set and `ctx.json` is
/// not.
pub fn run_with_io(
    ctx: &Context,
    args: &InitArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    let Some(existing) = ctx.store.board()? else {
        let board = ctx.store.create_board(&args.name, ctx.clock.now())?;
        return Ok(Outcome {
            changed: true,
            human: format!("Created board \"{}\".\n", board.name),
            json: json!({"board": board}),
        });
    };

    // Check the name before asking anyone to confirm it.
    let name = validate_board_name(&args.name)?;
    if ctx.json || !ctx.interactive {
        return Err(SkanError::ConfirmationRequired {
            operation: "replacing the board".to_string(),
        });
    }
    let prompt = format!(
        "A board \"{}\" already exists. Replace it with an empty board \"{name}\"? All cards and history will be deleted.",
        existing.name
    );
    if !confirm::confirm(&prompt, input, output)? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".to_string(),
            json: json!({"cancelled": true}),
        });
    }
    let board = ctx.store.reset_board(&name, ctx.clock.now())?;
    Ok(Outcome {
        changed: true,
        human: format!(
            "Replaced the board with an empty board \"{}\".\n",
            board.name
        ),
        json: json!({"board": board}),
    })
}
