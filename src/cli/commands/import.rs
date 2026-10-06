use crate::cli::args::ImportArgs;
use crate::cli::{Context, Outcome, Target};
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
    let board = backup.validate().map_err(|e| match e {
        SkanError::ImportInvalid { reason, .. } => SkanError::ImportInvalid {
            file: path.display().to_string(),
            reason,
        },
        other => other,
    })?;
    // Only the named project is touched. A project that does not exist is
    // created from the backup when the names match; an existing one is
    // replaced, by ID, after a human confirms.
    let project = match &ctx.target {
        Target::Missing { name } => {
            ctx.store
                .create_from_backup(name, &board)
                .map_err(|e| match e {
                    SkanError::ImportInvalid { reason, .. } => SkanError::ImportInvalid {
                        file: path.display().to_string(),
                        reason,
                    },
                    other => other,
                })?
        }
        Target::Existing(existing) => {
            if ctx.json || !ctx.interactive {
                return Err(SkanError::ConfirmationRequired {
                    operation: "replacing the board".into(),
                });
            }
            let prompt = if existing.name == board.metadata.name {
                format!(
                    "Replace the board of project \"{}\" with this backup? All its current cards and history will be replaced.",
                    existing.name
                )
            } else {
                format!(
                    "Replace the board of project \"{}\" with this backup, and rename the project to \"{}\"? All its current cards and history will be replaced.",
                    existing.name, board.metadata.name
                )
            };
            if !confirm::confirm(&prompt, input, output)? {
                return Ok(Outcome {
                    changed: false,
                    human: "Cancelled. Nothing was changed.\n".into(),
                    json: json!({"cancelled": true}),
                });
            }
            ctx.store.restore_project(&existing.id, &board)?
        }
    };
    Ok(Outcome {
        changed: true,
        human: format!("Imported board from {}.\n", path.display()),
        json: json!({"project": project, "board": board.metadata, "cards": board.cards}),
    })
}
