//! Arguments of `agboard history`.

use std::io::Read;
use std::path::PathBuf;

use clap::{Args, Subcommand};

use super::enums::ActorArg;
use crate::error::{AgboardError, FileAction};

#[derive(Args, Debug)]
pub struct HistoryArgs {
    #[command(subcommand)]
    pub command: HistoryCommand,
}

#[derive(Subcommand, Debug)]
pub enum HistoryCommand {
    /// Append an AI work note, with an automatic UTC timestamp
    Add(HistoryAddArgs),
}

#[derive(Args, Debug)]
pub struct HistoryAddArgs {
    pub id: i64,
    /// Work note; omitted or blank generates a current-state description
    #[arg(
        long,
        value_name = "TEXT",
        allow_hyphen_values = true,
        group = "reason_source"
    )]
    pub reason: Option<String>,
    #[arg(long, value_name = "PATH", group = "reason_source")]
    pub reason_file: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct ChangeArgs {
    /// Optional explanation; use - to read UTF-8 from stdin
    #[arg(
        long,
        value_name = "TEXT",
        allow_hyphen_values = true,
        group = "reason_source"
    )]
    pub reason: Option<String>,
    /// Read the explanation from a UTF-8 file
    #[arg(long, value_name = "PATH", group = "reason_source")]
    pub reason_file: Option<PathBuf>,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

impl ChangeArgs {
    pub fn resolve_reason(&self) -> Result<String, AgboardError> {
        match read_reason(self.reason.as_deref(), self.reason_file.as_deref())? {
            Some(raw) if !raw.trim().is_empty() => {
                crate::domain::validate_work_reason(&raw)?;
                Ok(raw)
            }
            _ => Ok(String::new()),
        }
    }
}

/// The raw text of a reason given as `--reason` (`-` reads standard input) or
/// as `--reason-file`, or `None` when neither was given. The text is not checked here.
pub fn read_reason(
    reason: Option<&str>,
    reason_file: Option<&std::path::Path>,
) -> Result<Option<String>, AgboardError> {
    if let Some(path) = reason_file {
        return std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| AgboardError::FileError {
                action: FileAction::Read,
                file: path.display().to_string(),
                reason: e.to_string(),
            });
    }
    match reason {
        None => Ok(None),
        Some("-") => {
            let mut value = String::new();
            std::io::stdin()
                .read_to_string(&mut value)
                .map_err(|e| AgboardError::FileError {
                    action: FileAction::Read,
                    file: "standard input".into(),
                    reason: e.to_string(),
                })?;
            Ok(Some(value))
        }
        Some(text) => Ok(Some(text.to_string())),
    }
}
