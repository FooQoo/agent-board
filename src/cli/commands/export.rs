use std::path::{Component, Path, PathBuf};

use serde_json::json;

use crate::cli::args::ExportArgs;
use crate::cli::{Context, Outcome};
use crate::error::{FileAction, SkanError};
use crate::transfer;

pub fn run(ctx: &mut Context, args: &ExportArgs) -> Result<Outcome, SkanError> {
    let cwd = std::env::current_dir().map_err(|e| SkanError::FileError {
        action: FileAction::Read,
        file: "the current directory".to_string(),
        reason: e.to_string(),
    })?;
    run_in(ctx, args, &cwd)
}

/// Like [`run`], with the current directory given.
pub fn run_in(ctx: &Context, args: &ExportArgs, cwd: &Path) -> Result<Outcome, SkanError> {
    let snapshot = ctx.store.snapshot()?;
    let file = transfer::to_export_file(&snapshot);
    let path = transfer::resolve_output(args.output.as_deref(), cwd);
    transfer::write_atomic(&path, &transfer::serialize(&file))?;

    let count = file.cards.len();
    Ok(Outcome {
        // Writing a file does not change the board.
        changed: false,
        human: format!(
            "Exported {} to {}.\n",
            cards_text(count),
            display_path(&path, cwd)
        ),
        json: json!({"path": path.display().to_string(), "cards": count}),
    })
}

/// `1 card`, `8 cards`.
pub(super) fn cards_text(count: usize) -> String {
    match count {
        1 => "1 card".to_string(),
        n => format!("{n} cards"),
    }
}

/// A path as shown to a human: under `cwd` (or relative to it) as `./sub/file`,
/// anything else as it is.
pub(super) fn display_path(path: &Path, cwd: &Path) -> String {
    let relative: PathBuf = if path.is_absolute() {
        match path.strip_prefix(cwd) {
            Ok(rest) => rest.to_path_buf(),
            Err(_) => return path.display().to_string(),
        }
    } else {
        path.to_path_buf()
    };
    if matches!(
        relative.components().next(),
        Some(Component::CurDir | Component::ParentDir)
    ) {
        return relative.display().to_string();
    }
    format!("./{}", relative.display())
}
