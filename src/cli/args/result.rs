//! Arguments of `agboard result`.

use std::path::PathBuf;

use clap::{Args, Subcommand};

use super::enums::ActorArg;

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo result add 12 --title \"First draft\" --summary \"First 30 seconds are ready\" --link ./out/draft.mp4 --actor ai\n  agboard --project demo result add 12 --summary \"Top page capture\" --file top.png --key top-v1 --actor ai\n  agboard --project demo result add 12 --summary \"Mock screens\" --file 01.png --file 02.png --file 03.png --actor ai\n  agboard --project demo result add 12 --summary \"Finished\" --final --actor ai\n  agboard --project demo result ls 12"
)]
pub struct ResultArgs {
    #[command(subcommand)]
    pub command: ResultCommand,
}

#[derive(Subcommand, Debug)]
pub enum ResultCommand {
    /// List the results recorded on a task
    Ls(ResultLsArgs),
    /// Record a result for the requester; the work goes on
    Add(ResultAddArgs),
}

#[derive(Args, Debug)]
pub struct ResultLsArgs {
    /// ID of the task
    pub task_id: i64,
}

#[derive(Args, Debug)]
pub struct ResultAddArgs {
    /// ID of the task
    pub task_id: i64,
    /// Heading of the result (1 to 80 characters, one line); without it the first sentence of the summary is used
    #[arg(long, value_name = "TEXT")]
    pub title: Option<String>,
    /// Short text that says what the requester can look at (1 to 2000 characters)
    #[arg(long, value_name = "TEXT")]
    pub summary: String,
    /// Image of the result (PNG, JPEG, WebP, or GIF), stored as an attachment of the task; repeat it to put several images (up to 20, in order) on one result
    #[arg(long, value_name = "PATH")]
    pub file: Vec<PathBuf>,
    /// Link or storage location of the main artifact
    #[arg(long, value_name = "URL_OR_PATH")]
    pub link: Option<String>,
    /// Mark the result as the final one; without it the result is in progress
    #[arg(long = "final")]
    pub is_final: bool,
    /// Key that makes a retry safe; by default it is derived from the content
    #[arg(long, value_name = "KEY")]
    pub key: Option<String>,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}
