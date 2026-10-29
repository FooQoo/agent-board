//! Arguments of `agboard project`.

use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Args, Debug)]
pub struct ProjectArgs {
    #[command(subcommand)]
    pub command: ProjectCommand,
}

#[derive(Subcommand, Debug)]
pub enum ProjectCommand {
    /// Create an empty project (no --project needed)
    #[command(after_help = "Examples:\n  agboard project create \"My project\"")]
    Create(ProjectCreateArgs),
    /// List the projects (no --project needed)
    #[command(after_help = "Examples:\n  agboard project ls\n  agboard project ls --json")]
    Ls,
    /// Bind an existing project to a folder (no --project needed)
    #[command(
        after_help = "Examples:\n  agboard project bind \"My project\"\n  agboard project bind \"My project\" --folder ../other"
    )]
    Bind(ProjectBindArgs),
    /// Rename the project named with --project
    #[command(
        after_help = "Examples:\n  agboard --project \"My project\" project rename \"Renamed project\"\n\nHook commands name the project; update them after a rename."
    )]
    Rename(ProjectRenameArgs),
    /// Delete the project named with --project and all its tasks (humans only)
    #[command(after_help = "Examples:\n  agboard --project \"My project\" project rm")]
    Rm,
}

#[derive(Args, Debug)]
pub struct ProjectCreateArgs {
    /// Name of the new project (1 to 50 characters, one line)
    pub name: String,
    /// Folder to bind the project to (default: the current folder)
    #[arg(long, value_name = "DIR")]
    pub folder: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct ProjectBindArgs {
    /// Name of the existing project (1 to 50 characters, one line)
    pub name: String,
    /// Folder to bind (default: the current folder)
    #[arg(long, value_name = "DIR")]
    pub folder: Option<PathBuf>,
}

#[derive(Args, Debug)]
pub struct ProjectRenameArgs {
    /// The project's new name (1 to 50 characters, one line)
    pub new_name: String,
}
