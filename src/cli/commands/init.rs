use std::io::{BufRead, Write};

use serde_json::json;

use crate::cli::args::InitArgs;
use crate::cli::{Context, Outcome, Target};
use crate::domain::BoardMeta;
use crate::error::AgboardError;
use crate::interact::confirm;

pub fn run(ctx: &mut Context, args: &InitArgs) -> Result<Outcome, AgboardError> {
    // `run.rs` does not know about terminals yet; ask here.
    ctx.interactive = ctx.interactive || confirm::is_interactive(ctx.json);
    let stdin = std::io::stdin();
    run_with_io(ctx, args, &mut stdin.lock(), &mut std::io::stderr())
}

/// Like [`run`], with the answer's source and the prompt's destination given.
/// A human can be asked only when `ctx.interactive` is set and `ctx.json` is
/// not.
///
/// `init` works on the one project named with `--project`: it creates the
/// project when it does not exist, and otherwise empties that project's board
/// after a human confirms. No other project is touched.
pub fn run_with_io(
    ctx: &Context,
    _args: &InitArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, AgboardError> {
    let existing = match &ctx.target {
        Target::Missing { name } => {
            let project = ctx.files.create_project(name, ctx.clock.now())?;
            let board = BoardMeta {
                name: project.name.clone(),
                next_card_id: 1,
                created_at: project.created_at,
            };
            return Ok(Outcome {
                changed: true,
                human: format!("Created project \"{}\".\n", project.name),
                json: json!({"project": project, "board": board}),
            });
        }
        Target::Catalog => {
            return Err(AgboardError::InvalidArgument {
                message: "--project NAME is required.".to_string(),
                command: Some("init".to_string()),
            });
        }
        Target::Existing(meta) => meta,
    };

    if ctx.json || !ctx.interactive {
        return Err(AgboardError::ConfirmationRequired {
            operation: "replacing the board".to_string(),
        });
    }
    let prompt = format!(
        "Project \"{}\" already has a board. Replace it with an empty board? All its cards and history will be deleted.",
        existing.name
    );
    if !confirm::confirm(&prompt, input, output)? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".to_string(),
            json: json!({"cancelled": true}),
        });
    }
    // The ID was fixed before the question. If the project was deleted while
    // the human decided, this is `project_not_found`, never another project.
    let reset = ctx.files.reset_project(&existing.id)?;
    Ok(Outcome {
        changed: reset.changed,
        human: format!(
            "Replaced the board of project \"{}\" with an empty board.\n",
            existing.name
        ),
        json: json!({"project": existing, "board": reset.value}),
    })
}
