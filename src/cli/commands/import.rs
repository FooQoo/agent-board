use crate::cli::args::ImportArgs;
use crate::cli::{Context, Outcome};
use crate::{
    error::{FileAction, SkanError},
    interact::confirm,
    transfer::Backup,
};
use serde_json::json;
use std::{
    fs,
    io::{BufRead, Write},
    path::PathBuf,
};

pub fn run(ctx: &mut Context, args: &ImportArgs) -> Result<Outcome, SkanError> {
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
    args: &ImportArgs,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    let path = args
        .file
        .clone()
        .unwrap_or_else(|| PathBuf::from("skan.json"));
    let bytes = fs::read(&path).map_err(|e| SkanError::FileError {
        action: FileAction::Read,
        file: path.display().to_string(),
        reason: e.to_string(),
    })?;
    let backup: Backup = serde_json::from_slice(&bytes).map_err(|e| SkanError::ImportInvalid {
        file: path.display().to_string(),
        reason: e.to_string(),
    })?;
    let snapshot = backup.validate().map_err(|e| match e {
        SkanError::ImportInvalid { reason, .. } => SkanError::ImportInvalid {
            file: path.display().to_string(),
            reason,
        },
        other => other,
    })?;
    if ctx.store.board()?.is_some() {
        if ctx.json || !ctx.interactive {
            return Err(SkanError::ConfirmationRequired {
                operation: "replacing the board".into(),
            });
        }
        if !confirm::confirm(
            "Replace the current board with this backup? All current cards and history will be replaced.",
            input,
            output,
        )? {
            return Ok(Outcome {
                changed: false,
                human: "Cancelled. Nothing was changed.\n".into(),
                json: json!({"cancelled": true}),
            });
        }
    }
    ctx.store.replace_all(&snapshot)?;
    Ok(Outcome {
        changed: true,
        human: format!("Imported board from {}.\n", path.display()),
        json: json!({"board": snapshot.board, "cards": snapshot.cards}),
    })
}
