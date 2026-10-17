use crate::cli::args::RmArgs;
use crate::cli::{Context, Outcome};
use crate::{error::AgboardError, interact::confirm};
use serde_json::json;
use std::io::{BufRead, Write};

pub fn run(ctx: &mut Context, args: &RmArgs) -> Result<Outcome, AgboardError> {
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
) -> Result<Outcome, AgboardError> {
    let project_id = ctx.project_id()?;
    let task = ctx.files.task(project_id, args.id)?;
    if ctx.json || !ctx.interactive {
        return Err(AgboardError::ConfirmationRequired {
            operation: "deleting a task".into(),
        });
    }
    if !confirm::confirm(
        &format!("Delete #{} {}? This cannot be undone.", task.id, task.title),
        input,
        output,
    )? {
        return Ok(Outcome {
            changed: false,
            human: "Cancelled. Nothing was changed.\n".into(),
            json: json!({"cancelled": true}),
        });
    }
    ctx.files.delete_task(project_id, args.id)?;
    Ok(Outcome {
        changed: true,
        human: format!("Deleted #{}.\n", args.id),
        json: json!({"deleted": args.id}),
    })
}
