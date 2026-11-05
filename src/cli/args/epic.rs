//! Arguments of `agboard epic`.

use std::io::Read;
use std::path::PathBuf;

use clap::{Args, Subcommand};

use super::enums::ActorArg;
use super::task::strip_final_newline;
use crate::error::{AgboardError, FileAction};

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo epic add file-share --name \"File share\" --actor human\n  agboard --project demo epic add file-share --name \"File share\" --color '#7C3AED' --actor human\n  agboard --project demo epic ls --json\n  agboard --project demo epic show FILE-SHARE\n  agboard --project demo epic edit FILE-SHARE --document-file epic.md\n  agboard --project demo epic rm FILE-SHARE"
)]
pub struct EpicArgs {
    #[command(subcommand)]
    pub command: EpicCommand,
}

#[derive(Subcommand, Debug)]
pub enum EpicCommand {
    /// Create an epic with an empty document (EPIC-ID, name, and an optional color)
    Add(EpicAddArgs),
    /// List the epics in EPIC-ID order
    Ls,
    /// Show an epic, its color, and its full document
    Show(EpicIdArgs),
    /// Change an epic's name, color, document, or task order; a draft epic is refused with epic_is_draft
    Edit(EpicEditArgs),
    /// Delete an epic (humans only; asks for confirmation)
    Rm(EpicIdArgs),
}

#[derive(Args, Debug)]
pub struct EpicIdArgs {
    /// The epic's EPIC-ID (letters, digits, and hyphens; lowercase is folded)
    pub id: String,
}

#[derive(Args, Debug)]
pub struct EpicAddArgs {
    /// The epic's EPIC-ID (letters, digits, and hyphens)
    pub id: String,
    /// Formal name of the epic (1 to 100 characters, one line)
    #[arg(long, value_name = "NAME")]
    pub name: String,
    /// Color as #RRGGBB; a random color that no epic uses when omitted
    #[arg(long, value_name = "#RRGGBB")]
    pub color: Option<String>,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
pub struct EpicEditArgs {
    /// The epic's EPIC-ID
    pub id: String,
    /// New formal name
    #[arg(long, value_name = "NAME")]
    pub name: Option<String>,
    /// New color as #RRGGBB
    #[arg(long, value_name = "#RRGGBB")]
    pub color: Option<String>,
    /// Task order of the epic as comma-separated task IDs (for example 24,26,25); empty clears it
    #[arg(long, value_name = "IDS", allow_hyphen_values = true)]
    pub priority: Option<String>,
    #[command(flatten)]
    pub document: DocumentArgs,
}

/// The two ways to give an epic document: the text itself, or a file. `-` reads standard input.
#[derive(Args, Debug, Clone, Default)]
#[group(id = "document_source", multiple = false)]
pub struct DocumentArgs {
    /// Whole EPIC.md text in Markdown, frontmatter included, up to 100,000 characters; use "-" to read it from standard input
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub document: Option<String>,
    /// Read the whole EPIC.md text, frontmatter included (up to 100,000 characters), from a file
    #[arg(long, value_name = "PATH")]
    pub document_file: Option<PathBuf>,
}

impl DocumentArgs {
    /// The document the user asked for, or `None` when neither option was given.
    pub fn resolve(&self, stdin: &mut dyn Read) -> Result<Option<String>, AgboardError> {
        if let Some(text) = &self.document
            && text == "-"
        {
            let mut buffer = String::new();
            stdin
                .read_to_string(&mut buffer)
                .map_err(|e| AgboardError::FileError {
                    action: FileAction::Read,
                    file: "standard input".to_string(),
                    reason: e.to_string(),
                })?;
            return Ok(Some(strip_final_newline(buffer)));
        }
        if let Some(text) = &self.document {
            return Ok(Some(text.clone()));
        }
        if let Some(path) = &self.document_file {
            let text = std::fs::read_to_string(path).map_err(|e| AgboardError::FileError {
                action: FileAction::Read,
                file: path.display().to_string(),
                reason: e.to_string(),
            })?;
            return Ok(Some(strip_final_newline(text)));
        }
        Ok(None)
    }
}
