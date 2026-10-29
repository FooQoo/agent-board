//! Arguments of `agboard attachment`.

use std::path::PathBuf;

use clap::{Args, Subcommand};

use super::enums::ActorArg;

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo attachment ls 12\n  agboard --project demo attachment add 12 --file image.png --actor ai\n  agboard --project demo attachment get 12 <attachment-id> --output image.png"
)]
pub struct AttachmentArgs {
    #[command(subcommand)]
    pub command: AttachmentCommand,
}

#[derive(Subcommand, Debug)]
pub enum AttachmentCommand {
    /// List image metadata for a task
    Ls(AttachmentLsArgs),
    /// Add an image file to a task
    Add(AttachmentAddArgs),
    /// Write an image attachment to a new file
    Get(AttachmentGetArgs),
}

#[derive(Args, Debug)]
pub struct AttachmentLsArgs {
    /// ID of the task
    pub task_id: i64,
}

#[derive(Args, Debug)]
pub struct AttachmentAddArgs {
    /// ID of the task
    pub task_id: i64,
    /// Image file to add
    #[arg(long, value_name = "PATH")]
    pub file: PathBuf,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
pub struct AttachmentGetArgs {
    /// ID of the task
    pub task_id: i64,
    /// Attachment ID
    pub attachment_id: String,
    /// New output file; an existing file is never overwritten
    #[arg(long, value_name = "PATH")]
    pub output: PathBuf,
}
