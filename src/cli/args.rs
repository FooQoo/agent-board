//! Command line definition (clap derive) and argument post-validation.

mod agent;
mod attachment;
mod enums;
mod epic;
mod help;
mod history;
mod project;
mod task;
mod validate;

pub use self::agent::*;
pub use self::attachment::*;
pub use self::enums::*;
pub use self::epic::*;
pub use self::history::*;
pub use self::project::*;
pub use self::task::*;
pub use self::validate::*;

use std::ffi::OsString;

use clap::{Parser, Subcommand};

use self::help::TOP_HELP;
use crate::error::AgboardError;

#[derive(Parser, Debug)]
#[command(
    name = "agboard",
    version,
    disable_help_subcommand = true,
    override_help = TOP_HELP
)]
pub struct Cli {
    /// The project to work on. Progress and hooks resolve the nearest folder
    /// binding when omitted; most other commands require this value.
    #[arg(long, global = true, value_name = "NAME")]
    project: Option<String>,
    /// Print machine-readable JSON instead of text.
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Create, list, rename, or delete projects
    Project(ProjectArgs),
    /// Create the project's board, or empty an existing one
    Init(InitArgs),
    /// Add a task to Todo
    Add(AddArgs),
    /// Change a task's title or description
    Edit(EditArgs),
    /// Move a task to todo, doing, or done
    Mv(MvArgs),
    /// Report a task's run state: idle, running, or pending
    State(StateArgs),
    /// Append a work note to a task history
    History(HistoryArgs),
    /// Delete a task (humans only; asks for confirmation)
    Rm(RmArgs),
    /// List tasks
    Ls(LsArgs),
    /// Show a task and its history
    Show(ShowArgs),
    /// Add, list, or read image attachments
    Attachment(AttachmentArgs),
    /// Create, list, show, edit, or delete epics
    Epic(EpicArgs),
    /// Fetch the complete board and history without modifying it
    Snapshot(SnapshotArgs),
    /// Add the current progress table to an agent hook
    Hook(HookArgs),
    /// Wait for a board change or the next task
    Wait(WaitArgs),
    /// Show the board in your browser
    Serve(ServeArgs),
    /// Stop the running server (the one started with serve, or serve -d)
    #[command(after_help = "Examples:\n  agboard stop\n  agboard stop --json")]
    Stop(StopArgs),
    /// Create the data folder and add it to Codex and Claude Code settings
    Setup(SetupArgs),
    /// Install the Skill and Hook for Claude Code and Codex (interactive)
    #[command(after_help = "Examples:\n  agboard project create \"My project\"\n  agboard connect")]
    Connect(ConnectArgs),
    /// Update the installed Skill and Hook to this version
    #[command(after_help = "Examples:\n  agboard update\n  agboard update --yes")]
    Update(UpdateArgs),
    /// Show the project's shared folder and where its files are
    Workspace(WorkspaceArgs),
    /// Show the tasks an agent can pick up, by epic in priority order
    #[command(
        after_help = "Examples:\n  agboard progress\n  agboard progress --json\n  agboard progress --include-pending --include-done 5\n  agboard --project \"My project\" progress --json"
    )]
    Progress(ProgressArgs),
}

impl Command {
    /// The subcommand's name as typed on the command line.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Project(_) => "project",
            Command::Init(_) => "init",
            Command::Add(_) => "add",
            Command::Edit(_) => "edit",
            Command::Mv(_) => "mv",
            Command::State(_) => "state",
            Command::History(_) => "history",
            Command::Rm(_) => "rm",
            Command::Ls(_) => "ls",
            Command::Show(_) => "show",
            Command::Attachment(_) => "attachment",
            Command::Epic(_) => "epic",
            Command::Snapshot(_) => "snapshot",
            Command::Hook(_) => "hook",
            Command::Wait(_) => "wait",
            Command::Serve(_) => "serve",
            Command::Stop(_) => "stop",
            Command::Setup(_) => "setup",
            Command::Connect(_) => "connect",
            Command::Update(_) => "update",
            Command::Workspace(_) => "workspace",
            Command::Progress(_) => "progress",
        }
    }
}

pub const SUBCOMMAND_NAMES: [&str; 22] = [
    "project",
    "init",
    "add",
    "edit",
    "mv",
    "state",
    "history",
    "rm",
    "ls",
    "show",
    "attachment",
    "epic",
    "snapshot",
    "serve",
    "stop",
    "hook",
    "wait",
    "workspace",
    "progress",
    "setup",
    "connect",
    "update",
];

/// What parsing the command line produced.
#[derive(Debug)]
pub enum Parsed {
    /// A command to run.
    Run(Cli),
    /// `--help` or `--version`: print this text to standard output, exit 0.
    Print(String),
}

/// Parse `args` (the first item is the program name).
pub fn parse(args: &[OsString]) -> Result<Parsed, AgboardError> {
    match Cli::try_parse_from(args) {
        // The parser lets a later `--project` after the subcommand replace an
        // earlier one before it; a command must never guess which one was meant.
        Ok(_) if project_occurrences(args) > 1 => Err(AgboardError::InvalidArgument {
            message: "--project can be given only once.".to_string(),
            command: subcommand_in(args),
        }),
        Ok(cli) => Ok(Parsed::Run(cli)),
        Err(error) => {
            use clap::error::ErrorKind;
            match error.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
                    Ok(Parsed::Print(error.to_string()))
                }
                kind => Err(AgboardError::InvalidArgument {
                    message: match kind {
                        // The parser would print the whole help text here.
                        ErrorKind::MissingSubcommand
                        | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
                            "a command is required.".to_string()
                        }
                        _ => parser_message(&error.to_string()),
                    },
                    command: subcommand_in(args),
                }),
            }
        }
    }
}

/// How many times `--project` appears as an option (not as the value of
/// another option). Everything after `--` is a value.
fn project_occurrences(args: &[OsString]) -> usize {
    let mut count = 0;
    let mut skip_next = false;
    for arg in args.iter().skip(1) {
        let Some(arg) = arg.to_str() else { continue };
        if skip_next {
            skip_next = false;
            continue;
        }
        match arg {
            "--" => break,
            "--project" => {
                count += 1;
                skip_next = true; // its value
            }
            // These take a value that may itself start with a dash.
            "--desc" | "--reason" => skip_next = true,
            _ if arg.starts_with("--project=") => count += 1,
            _ => {}
        }
    }
    count
}

/// The parser's one-line message: the first line without its `error: ` prefix,
/// plus the list of possible values when the parser gives one.
fn parser_message(rendered: &str) -> String {
    let mut lines = rendered.lines();
    let first = lines.next().unwrap_or_default();
    let mut message = first.strip_prefix("error: ").unwrap_or(first).to_string();
    if let Some(values) = lines
        .map(str::trim)
        .find(|line| line.starts_with("[possible values:"))
    {
        message.push(' ');
        message.push_str(values);
    }
    message
}

/// The subcommand named on the command line, if any: the first argument that
/// is not an option.
fn subcommand_in(args: &[OsString]) -> Option<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| arg.to_str())
        .find(|arg| !arg.starts_with('-'))
        .filter(|arg| SUBCOMMAND_NAMES.contains(arg))
        .map(str::to_string)
}
