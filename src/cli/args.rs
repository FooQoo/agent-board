//! Command line definition (clap derive) and argument post-validation.

use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::domain::{Actor, Assignee, Column, RunState};
use crate::error::{FileAction, SkanError};

/// `agboard --help`: the board workflow for agents.
const TOP_HELP: &str = "\
agboard - a shared local work board for users and agents

Usage: agboard [--json] <COMMAND>

Commands:
  init    Create the board
  add     Add a card to Todo
  edit    Change a card's title or description
  mv      Move a card to todo, doing, or done
  state   Report a card's run state: idle, running, or pending
  rm      Delete a card (humans only; asks for confirmation)
  ls      List cards
  show    Show a card and its history
  snapshot Fetch the complete board and history
  hook    Add the latest board snapshot to an agent hook
  wait    Wait for a board change and fetch its history
  export  Write the board to a JSON file
  import  Restore the board from a JSON file
  serve   Show the board in your browser

Workflow for agents:
  agboard ls --json
  agboard mv <id> doing --actor ai --reason \"Start\"
  agboard state <id> running --actor ai --reason \"Working\"
  agboard state <id> pending --actor ai --reason \"Need a decision\"

Rules for agents:
  - Move a card to doing before you report running or pending.
  - Report pending with --reason when you are waiting for something.
  - Moving a card to todo or done resets it to idle.
  - You cannot delete cards or replace the board. Ask a human to do it.
  - Add --json to any command for machine-readable output.";

#[derive(Parser, Debug)]
#[command(
    name = "agboard",
    version,
    disable_help_subcommand = true,
    override_help = TOP_HELP
)]
pub struct Cli {
    /// Print machine-readable JSON instead of text.
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Create the board
    Init(InitArgs),
    /// Add a card to Todo
    Add(AddArgs),
    /// Change a card's title or description
    Edit(EditArgs),
    /// Move a card to todo, doing, or done
    Mv(MvArgs),
    /// Report a card's run state: idle, running, or pending
    State(StateArgs),
    /// Delete a card (humans only; asks for confirmation)
    Rm(RmArgs),
    /// List cards
    Ls(LsArgs),
    /// Show a card and its history
    Show(ShowArgs),
    /// Fetch the complete board and history without modifying it
    Snapshot(SnapshotArgs),
    Hook(HookArgs),
    Wait(WaitArgs),
    /// Write the board to a JSON file
    Export(ExportArgs),
    /// Restore the board from a JSON file
    Import(ImportArgs),
    /// Show the board in your browser
    Serve(ServeArgs),
}

impl Command {
    /// The subcommand's name as typed on the command line.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Init(_) => "init",
            Command::Add(_) => "add",
            Command::Edit(_) => "edit",
            Command::Mv(_) => "mv",
            Command::State(_) => "state",
            Command::Rm(_) => "rm",
            Command::Ls(_) => "ls",
            Command::Show(_) => "show",
            Command::Snapshot(_) => "snapshot",
            Command::Hook(_) => "hook",
            Command::Wait(_) => "wait",
            Command::Export(_) => "export",
            Command::Import(_) => "import",
            Command::Serve(_) => "serve",
        }
    }
}

pub const SUBCOMMAND_NAMES: [&str; 14] = [
    "init", "add", "edit", "mv", "state", "rm", "ls", "show", "snapshot", "export", "import",
    "serve", "hook", "wait",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AgentArg {
    Claude,
    Codex,
}

#[derive(Args, Debug)]
pub struct HookArgs {
    #[arg(long, value_enum)]
    pub agent: AgentArg,
}

#[derive(Args, Debug)]
pub struct WaitArgs {
    #[arg(long)]
    pub after: i64,
    #[arg(long)]
    pub timeout: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ColumnArg {
    Todo,
    Doing,
    Done,
}

impl ColumnArg {
    pub fn column(self) -> Column {
        match self {
            ColumnArg::Todo => Column::Todo,
            ColumnArg::Doing => Column::Doing,
            ColumnArg::Done => Column::Done,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum RunStateArg {
    Idle,
    Running,
    Pending,
}

impl RunStateArg {
    pub fn run_state(self) -> RunState {
        match self {
            RunStateArg::Idle => RunState::Idle,
            RunStateArg::Running => RunState::Running,
            RunStateArg::Pending => RunState::Pending,
        }
    }
}

/// The three mutually exclusive ways to give a description.
#[derive(Args, Debug, Clone, Default)]
#[group(id = "description_source", multiple = false)]
pub struct DescriptionArgs {
    /// Description text; use "-" to read it from standard input
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub desc: Option<String>,
    /// Read the description from a file
    #[arg(long, value_name = "PATH")]
    pub desc_file: Option<PathBuf>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard init --name \"My project\"")]
pub struct InitArgs {
    /// Name of the board
    #[arg(long, value_name = "NAME")]
    pub name: String,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard add \"Write the setup guide\"\n  agboard add \"Fix the login bug\" --desc \"Users cannot sign in on Safari\"\n  agboard add \"Plan the release\" --desc-file notes.txt\n  echo \"Details\" | agboard add \"Write the docs\" --desc -"
)]
pub struct AddArgs {
    /// Title of the card (1 to 100 characters, one line)
    pub title: String,
    #[command(flatten)]
    pub description: DescriptionArgs,
    /// Who owns this card
    #[arg(long, value_enum)]
    pub assignee: AssigneeArg,
    /// Who is creating this card
    #[arg(long, value_enum)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard edit 15 --title \"Write the install guide\"\n  agboard edit 15 --desc \"Steps for macOS and Linux\"\n  agboard edit 15 --desc \"\""
)]
pub struct EditArgs {
    /// ID of the card
    pub id: i64,
    /// New title
    #[arg(long, value_name = "TITLE")]
    pub title: Option<String>,
    #[command(flatten)]
    pub description: DescriptionArgs,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard mv 12 doing\n  agboard mv 12 done")]
pub struct MvArgs {
    /// ID of the card
    pub id: i64,
    /// Column to move the card to
    pub column: ColumnArg,
    #[command(flatten)]
    pub change: ChangeArgs,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Run states:\n  idle     not working on it\n  running  you are working on it now\n  pending  you are waiting; say what for with --reason\n\nExamples:\n  agboard state 12 running\n  agboard state 12 pending --reason \"Waiting for review\"\n  agboard state 12 idle"
)]
pub struct StateArgs {
    /// ID of the card
    pub id: i64,
    /// Run state to report
    pub state: RunStateArg,
    #[command(flatten)]
    pub change: ChangeArgs,
    /// Current pending request identifier, required when answering a request
    #[arg(long, value_name = "ID")]
    pub request: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ActorArg {
    Ai,
    Human,
}
impl ActorArg {
    pub fn actor(self) -> Actor {
        match self {
            Self::Ai => Actor::Ai,
            Self::Human => Actor::Human,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AssigneeArg {
    Ai,
    Human,
}
impl AssigneeArg {
    pub fn assignee(self) -> Assignee {
        match self {
            Self::Ai => Assignee::Ai,
            Self::Human => Assignee::Human,
        }
    }
}

#[derive(Args, Debug)]
pub struct ChangeArgs {
    /// Required explanation; use - to read UTF-8 from stdin
    #[arg(
        long,
        value_name = "TEXT",
        allow_hyphen_values = true,
        group = "reason_source",
        required_unless_present = "reason_file"
    )]
    pub reason: Option<String>,
    /// Read the explanation from a UTF-8 file
    #[arg(
        long,
        value_name = "PATH",
        group = "reason_source",
        required_unless_present = "reason"
    )]
    pub reason_file: Option<PathBuf>,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

impl ChangeArgs {
    pub fn resolve_reason(&self) -> Result<String, SkanError> {
        let raw = if let Some(path) = &self.reason_file {
            std::fs::read_to_string(path).map_err(|e| SkanError::FileError {
                action: FileAction::Read,
                file: path.display().to_string(),
                reason: e.to_string(),
            })?
        } else {
            let reason = self.reason.as_deref().unwrap_or_default();
            if reason == "-" {
                let mut value = String::new();
                std::io::stdin()
                    .read_to_string(&mut value)
                    .map_err(|e| SkanError::FileError {
                        action: FileAction::Read,
                        file: "standard input".into(),
                        reason: e.to_string(),
                    })?;
                value
            } else {
                reason.to_string()
            }
        };
        crate::domain::validate_work_reason(&raw)
    }
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard rm 11")]
pub struct RmArgs {
    /// ID of the card
    pub id: i64,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard ls\n  agboard ls --column doing\n  agboard ls --state pending --json"
)]
pub struct LsArgs {
    /// Only list cards in this column
    #[arg(long, value_name = "COLUMN")]
    pub column: Option<ColumnArg>,
    /// Only list cards with this run state
    #[arg(long, value_name = "STATE")]
    pub state: Option<RunStateArg>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard show 12\n  agboard show 12 --json")]
pub struct ShowArgs {
    /// ID of the card
    pub id: i64,
}

#[derive(Args, Debug)]
pub struct SnapshotArgs {}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard export\n  agboard export -o backup/board.json")]
pub struct ExportArgs {
    /// Output file, or a directory to write skan.json into
    #[arg(short, long, value_name = "PATH")]
    pub output: Option<PathBuf>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard import\n  agboard import backup/board.json")]
pub struct ImportArgs {
    /// Board file to read (default: skan.json in the current directory)
    pub file: Option<PathBuf>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard serve\n  agboard serve --port 7500")]
pub struct ServeArgs {
    /// Port to listen on (127.0.0.1 only)
    #[arg(long, value_name = "PORT", default_value_t = 7420)]
    pub port: u16,
}

/// What parsing the command line produced.
#[derive(Debug)]
pub enum Parsed {
    /// A command to run.
    Run(Cli),
    /// `--help` or `--version`: print this text to standard output, exit 0.
    Print(String),
}

/// Parse `args` (the first item is the program name).
pub fn parse(args: &[OsString]) -> Result<Parsed, SkanError> {
    match Cli::try_parse_from(args) {
        Ok(cli) => Ok(Parsed::Run(cli)),
        Err(error) => {
            use clap::error::ErrorKind;
            match error.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
                    Ok(Parsed::Print(error.to_string()))
                }
                kind => Err(SkanError::InvalidArgument {
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

impl Cli {
    /// Checks that depend on the combination of arguments, done before any
    /// board access so that a wrong command line always exits with 2.
    pub fn validate(&self) -> Result<(), SkanError> {
        match &self.command {
            Command::Edit(args)
                if args.title.is_none()
                    && args.description.desc.is_none()
                    && args.description.desc_file.is_none() =>
            {
                Err(SkanError::InvalidArgument {
                    message: "nothing to change; give --title, --desc, or --desc-file.".to_string(),
                    command: Some("edit".to_string()),
                })
            }
            Command::Snapshot(_) if !self.json => Err(SkanError::InvalidArgument {
                message: "snapshot requires --json.".into(),
                command: Some("snapshot".into()),
            }),
            _ => Ok(()),
        }
    }
}

impl DescriptionArgs {
    /// The description the user asked for: `None` when no option was given.
    /// `--desc -` reads `stdin` to the end. One trailing newline from a file
    /// or from standard input is dropped, since editors and `echo` add it.
    pub fn resolve(&self, stdin: &mut dyn Read) -> Result<Option<String>, SkanError> {
        if let Some(text) = &self.desc {
            if text != "-" {
                return Ok(Some(text.clone()));
            }
            let mut buffer = String::new();
            stdin
                .read_to_string(&mut buffer)
                .map_err(|e| SkanError::FileError {
                    action: FileAction::Read,
                    file: "standard input".to_string(),
                    reason: e.to_string(),
                })?;
            return Ok(Some(strip_final_newline(buffer)));
        }
        if let Some(path) = &self.desc_file {
            let text = std::fs::read_to_string(path).map_err(|e| SkanError::FileError {
                action: FileAction::Read,
                file: path.display().to_string(),
                reason: e.to_string(),
            })?;
            return Ok(Some(strip_final_newline(text)));
        }
        Ok(None)
    }
}

fn strip_final_newline(mut text: String) -> String {
    if text.ends_with('\n') {
        text.pop();
        if text.ends_with('\r') {
            text.pop();
        }
    }
    text
}
