use serde_json::json;

use crate::cli::args::InitArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(ctx: &mut Context, args: &InitArgs) -> Result<Outcome, SkanError> {
    if ctx.store.board()?.is_some() {
        // Replacing an existing board needs a human's confirmation; not built yet.
        return Err(SkanError::NotImplemented {
            command: "init".to_string(),
        });
    }
    let board = ctx.store.create_board(&args.name, ctx.clock.now())?;
    Ok(Outcome {
        changed: true,
        human: format!("Created board \"{}\".\n", board.name),
        json: json!({"board": board}),
    })
}
