use std::io::{BufRead, Write};
use std::path::Path;

use serde_json::json;

use super::export::{cards_text, display_path};
use crate::cli::args::ImportArgs;
use crate::cli::{Context, Outcome};
use crate::error::{FileAction, SkanError};
use crate::transfer;

/// The file read when no argument is given.
const DEFAULT_FILE: &str = "skan.json";

pub fn run(ctx: &mut Context, args: &ImportArgs) -> Result<Outcome, SkanError> {
    let cwd = std::env::current_dir().map_err(|e| SkanError::FileError {
        action: FileAction::Read,
        file: "the current directory".to_string(),
        reason: e.to_string(),
    })?;
    let stdin = std::io::stdin();
    run_with_io(ctx, args, &cwd, &mut stdin.lock(), &mut std::io::stderr())
}

/// Like [`run`], with the current directory, the answer's source, and the
/// prompt's destination given.
pub fn run_with_io(
    ctx: &Context,
    args: &ImportArgs,
    cwd: &Path,
    _input: &mut impl BufRead,
    _output: &mut impl Write,
) -> Result<Outcome, SkanError> {
    let file = args
        .file
        .as_deref()
        .unwrap_or_else(|| Path::new(DEFAULT_FILE));
    // Validate first: an invalid file fails before anyone is asked anything.
    let snapshot = transfer::read_and_validate(file)?;

    if ctx.store.board()?.is_some() {
        return Err(SkanError::NotImplemented {
            command: "import".to_string(),
        });
    }
    ctx.store.replace_all(&snapshot)?;

    Ok(Outcome {
        changed: true,
        human: format!(
            "Imported board \"{}\" with {} from {}.\n",
            snapshot.board.name,
            cards_text(snapshot.cards.len()),
            display_path(file, cwd)
        ),
        json: json!({"board": snapshot.board, "cards": snapshot.cards.len()}),
    })
}
