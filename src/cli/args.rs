//! Command line definition (clap derive) and argument post-validation.

use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::domain::{Actor, Assignee, ChangeCursor, Column, RunState};
use crate::error::{FileAction, SkanError};

/// `agboard --help`: the board workflow for agents.
const TOP_HELP: &str = "\
agboard - a shared local work board for users and agents

Usage: agboard --project NAME [--json] <COMMAND>

Every board command names one project with --project NAME. The read-only
`serve` command operates on the whole data area.
Nothing is chosen for you: leave it out and the command fails. The one
exception is the read-only `ls --all-projects`, which lists every project.

Commands:
  project Create, list, rename, or delete projects
  init    Create the project's board, or empty an existing one
  add     Add a card to Todo
  edit    Change a card's title or description
  mv      Move a card to todo, doing, or done
  state   Report a card's run state: idle, running, or pending
  rm      Delete a card (humans only; asks for confirmation)
  ls      List cards
  show    Show a card and its history
  epic    Create, list, show, edit, or delete epics and their plans
  evidence Add, show, or delete a card's text evidence
  attachment Add, list, or read image attachments
  snapshot Fetch the complete board and history
  hook    Add the latest board snapshot to an agent hook
  wait    Wait for a board change and fetch its history
  workspace Show the project's shared folder and where its files are
  serve   Show the board in your browser

Workflow for agents:
  agboard project ls --json
  agboard --project NAME workspace --json
  agboard --project NAME snapshot --json
  agboard --project NAME ls --json
  agboard ls --all-projects --json
  agboard --project NAME mv <id> doing --actor ai --reason \"Start\"
  agboard --project NAME state <id> running --actor ai --reason \"Working\"
  agboard --project NAME state <id> pending --actor ai --reason \"Need a decision\"

Rules for agents:
  - Move a card to doing before you report running or pending.
  - Report pending with --reason when you are waiting for something.
  - Moving a card to todo or done resets it to idle.
  - You cannot delete cards or projects, or replace a board. Ask a human to do it.
  - Get the shared folder from workspace --json; do not assume its location.
  - Do not edit TASK.md of a draft card, and do not edit task.json, epic.json,
    or project.json directly.
  - Do not delete card or epic folders; ask a human to do it.
  - After renaming a project, update the project name in your hook commands.
  - Add --json to any command for machine-readable output.

Descriptions and drafts:
  - A description is Markdown, up to 50,000 characters. Give a long one with
    --desc-file PATH (or --desc - on standard input), not --desc TEXT.
  - Snapshots, `show`, `wait`, and the hook return every description in full.
    If the hook's snapshot would exceed 256 KiB, it reports AGBOARD_ERROR
    (context_too_large) instead; use `snapshot --json` to read the board.
  - A card with \"isDraft\": true is a draft the user is still writing. It is
    read-only for you: `edit`, `mv`, and `state` fail with card_is_draft
    (exit code 1) and change nothing. Do not retry. Wait for the user to
    finalize it, and work on other cards meanwhile. `add`, `show`, `ls`,
    `snapshot`, and `wait` still work.";

#[derive(Parser, Debug)]
#[command(
    name = "agboard",
    version,
    disable_help_subcommand = true,
    override_help = TOP_HELP
)]
pub struct Cli {
    /// The project to work on. Required by every command except project
    /// create, project ls and serve. Give it once.
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
    /// Add, list, or read image attachments
    Attachment(AttachmentArgs),
    /// Create, list, show, edit, or delete epics
    Epic(EpicArgs),
    /// Add, show, or delete a card's text evidence
    Evidence(EvidenceArgs),
    /// Fetch the complete board and history without modifying it
    Snapshot(SnapshotArgs),
    /// Add the latest board snapshot to an agent hook
    Hook(HookArgs),
    /// Wait for a board change and fetch its history
    Wait(WaitArgs),
    /// Show the board in your browser
    Serve(ServeArgs),
    /// Show the project's shared folder and where its files are
    Workspace(WorkspaceArgs),
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
            Command::Rm(_) => "rm",
            Command::Ls(_) => "ls",
            Command::Show(_) => "show",
            Command::Attachment(_) => "attachment",
            Command::Epic(_) => "epic",
            Command::Evidence(_) => "evidence",
            Command::Snapshot(_) => "snapshot",
            Command::Hook(_) => "hook",
            Command::Wait(_) => "wait",
            Command::Serve(_) => "serve",
            Command::Workspace(_) => "workspace",
        }
    }
}

pub const SUBCOMMAND_NAMES: [&str; 17] = [
    "project",
    "init",
    "add",
    "edit",
    "mv",
    "state",
    "rm",
    "ls",
    "show",
    "attachment",
    "epic",
    "evidence",
    "snapshot",
    "serve",
    "hook",
    "wait",
    "workspace",
];

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
    /// Rename the project named with --project
    #[command(
        after_help = "Examples:\n  agboard --project \"My project\" project rename \"Renamed project\"\n\nHook commands name the project; update them after a rename."
    )]
    Rename(ProjectRenameArgs),
    /// Delete the project named with --project and all its cards (humans only)
    #[command(after_help = "Examples:\n  agboard --project \"My project\" project rm")]
    Rm,
}

#[derive(Args, Debug)]
pub struct ProjectCreateArgs {
    /// Name of the new project (1 to 50 characters, one line)
    pub name: String,
}

#[derive(Args, Debug)]
pub struct ProjectRenameArgs {
    /// The project's new name (1 to 50 characters, one line)
    pub new_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AgentArg {
    Claude,
    Codex,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo hook --agent claude\n  agboard --project demo hook --agent codex"
)]
pub struct HookArgs {
    #[arg(long, value_enum)]
    pub agent: AgentArg,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo wait --after 0123456789abcdef0123456789abcdef:12 --json\n  agboard --project demo wait --after 0123456789abcdef0123456789abcdef:12 --timeout 60 --json"
)]
pub struct WaitArgs {
    /// Cursor to wait after, as printed by snapshot: f1:<project-id>:<version>
    #[arg(long, value_name = "CURSOR", value_parser = parse_cursor)]
    pub after: ChangeCursor,
    #[arg(long)]
    pub timeout: Option<u64>,
}

fn parse_cursor(text: &str) -> Result<ChangeCursor, String> {
    text.parse::<ChangeCursor>().map_err(|e| e.reason())
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
    /// Description in Markdown, up to 50,000 characters; use "-" to read it from standard input
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub desc: Option<String>,
    /// Read the Markdown description (up to 50,000 characters) from a file
    #[arg(long, value_name = "PATH")]
    pub desc_file: Option<PathBuf>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project \"My project\" init")]
pub struct InitArgs {}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo add \"Write the setup guide\"\n  agboard --project demo add \"Fix the login bug\" --desc \"Users cannot sign in on Safari\"\n  agboard --project demo add \"Plan the release\" --desc-file notes.txt\n  echo \"Details\" | agboard --project demo add \"Write the docs\" --desc -"
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
    /// Epic to put the card in (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID")]
    pub epic: Option<String>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "A draft card (isDraft) is read-only for agents: edit fails with card_is_draft (exit code 1) and changes nothing. Wait for the user to finalize it, then try again.\n\nExamples:\n  agboard --project demo edit 15 --title \"Write the install guide\"\n  agboard --project demo edit 15 --desc \"Steps for macOS and Linux\"\n  agboard --project demo edit 15 --desc \"\""
)]
pub struct EditArgs {
    /// ID of the card
    pub id: i64,
    /// New title
    #[arg(long, value_name = "TITLE")]
    pub title: Option<String>,
    #[command(flatten)]
    pub description: DescriptionArgs,
    /// Put the card in this epic (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID", conflicts_with = "clear_epic")]
    pub epic: Option<String>,
    /// Take the card out of its epic
    #[arg(long, conflicts_with = "epic")]
    pub clear_epic: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "A draft card (isDraft) is read-only for agents: mv fails with card_is_draft (exit code 1). Wait for the user to finalize it.\n\nExamples:\n  agboard --project demo mv 12 doing\n  agboard --project demo mv 12 done"
)]
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
    after_help = "A draft card (isDraft) is read-only for agents: state fails with card_is_draft (exit code 1). Wait for the user to finalize it.\n\nRun states:\n  idle     not working on it, or an answer to a pending request\n  running  you are working on it now\n  pending  you are waiting; say what for with --reason or --request-file\n\nExamples:\n  agboard --project demo state 12 running --actor ai --reason \"Working\"\n  agboard --project demo state 12 pending --actor ai --reason \"Waiting for review\"\n  agboard --project demo state 12 pending --actor ai --request-file question.json\n  agboard --project demo state 12 idle --actor human --request ID --choice proceed\n  agboard --project demo state 12 idle --actor human --request ID --reason \"Go ahead.\""
)]
pub struct StateArgs {
    /// ID of the card
    pub id: i64,
    /// Run state to report
    pub state: RunStateArg,
    /// Required explanation (the question when pending); use - to read UTF-8 from stdin
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
    /// Current pending request identifier, required when answering a request
    #[arg(long, value_name = "ID")]
    pub request: Option<String>,
    /// Choice of the pending request to answer with (its CHOICE_ID)
    #[arg(long, value_name = "CHOICE_ID")]
    pub choice: Option<String>,
    /// A question and its choices (JSON) for a new pending request
    #[arg(long, value_name = "PATH")]
    pub request_file: Option<PathBuf>,
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
        match read_reason(self.reason.as_deref(), self.reason_file.as_deref())? {
            Some(raw) => crate::domain::validate_work_reason(&raw),
            None => crate::domain::validate_work_reason(""),
        }
    }
}

/// The raw text of a reason given as `--reason` (`-` reads standard input) or
/// as `--reason-file`, or `None` when neither was given. The text is not checked here.
pub fn read_reason(
    reason: Option<&str>,
    reason_file: Option<&std::path::Path>,
) -> Result<Option<String>, SkanError> {
    if let Some(path) = reason_file {
        return std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| SkanError::FileError {
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
                .map_err(|e| SkanError::FileError {
                    action: FileAction::Read,
                    file: "standard input".into(),
                    reason: e.to_string(),
                })?;
            Ok(Some(value))
        }
        Some(text) => Ok(Some(text.to_string())),
    }
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo epic add file-share --name \"File share\" --actor human\n  agboard --project demo epic add file-share --name \"File share\" --color '#7C3AED' --actor human\n  agboard --project demo epic ls --json\n  agboard --project demo epic show FILE-SHARE\n  agboard --project demo epic edit FILE-SHARE --plan-file plan.md\n  agboard --project demo epic rm FILE-SHARE"
)]
pub struct EpicArgs {
    #[command(subcommand)]
    pub command: EpicCommand,
}

#[derive(Subcommand, Debug)]
pub enum EpicCommand {
    /// Create an epic with a plan template (EPIC-ID, name, and an optional color)
    Add(EpicAddArgs),
    /// List the epics in EPIC-ID order
    Ls,
    /// Show an epic, its color, and its full plan
    Show(EpicIdArgs),
    /// Change an epic's name, color, or plan
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
    #[command(flatten)]
    pub plan: PlanArgs,
}

/// The two ways to give a plan: the text itself, or a file. `-` reads standard input.
#[derive(Args, Debug, Clone, Default)]
#[group(id = "plan_source", multiple = false)]
pub struct PlanArgs {
    /// Plan in Markdown, up to 50,000 characters; use "-" to read it from standard input
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub plan: Option<String>,
    /// Read the Markdown plan (up to 50,000 characters) from a file
    #[arg(long, value_name = "PATH")]
    pub plan_file: Option<PathBuf>,
}

impl PlanArgs {
    /// The plan the user asked for, or `None` when neither option was given.
    pub fn resolve(&self, stdin: &mut dyn Read) -> Result<Option<String>, SkanError> {
        if let Some(text) = &self.plan
            && text == "-"
        {
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
        if let Some(text) = &self.plan {
            return Ok(Some(text.clone()));
        }
        if let Some(path) = &self.plan_file {
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

#[derive(Args, Debug)]
pub struct EvidenceArgs {
    #[command(subcommand)]
    pub command: EvidenceCommand,
}

#[derive(Subcommand, Debug)]
pub enum EvidenceCommand {
    /// Add a UTF-8 text file to a card as evidence
    Add(EvidenceAddArgs),
    /// Print a card's evidence text
    Show(EvidenceIdArgs),
    /// Delete a card's evidence (humans only; asks for confirmation)
    Rm(EvidenceIdArgs),
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo evidence add 12 run.log\n  agboard --project demo evidence show 12 <evidence-id>"
)]
pub struct EvidenceAddArgs {
    /// ID of the card
    pub card_id: i64,
    /// UTF-8 text file to add
    pub path: PathBuf,
    /// Name to show for the evidence; the file name when omitted
    #[arg(long, value_name = "NAME")]
    pub name: Option<String>,
}

#[derive(Args, Debug)]
pub struct EvidenceIdArgs {
    /// ID of the card
    pub card_id: i64,
    /// Evidence ID
    pub evidence_id: String,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo rm 11")]
pub struct RmArgs {
    /// ID of the card
    pub id: i64,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo ls\n  agboard --project demo ls --column doing\n  agboard --project demo ls --state pending --json\n  agboard ls --all-projects\n  agboard ls --all-projects --state pending --json"
)]
pub struct LsArgs {
    /// List the cards of every project, read-only; do not give --project
    #[arg(long)]
    pub all_projects: bool,
    /// Only list cards in this column
    #[arg(long, value_name = "COLUMN")]
    pub column: Option<ColumnArg>,
    /// Only list cards with this run state
    #[arg(long, value_name = "STATE")]
    pub state: Option<RunStateArg>,
    /// Only list cards in this epic (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID")]
    pub epic: Option<String>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo show 12\n  agboard --project demo show 12 --json"
)]
pub struct ShowArgs {
    /// ID of the card
    pub id: i64,
}

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
    /// List image metadata for a card
    Ls(AttachmentLsArgs),
    /// Add an image file to a card
    Add(AttachmentAddArgs),
    /// Write an image attachment to a new file
    Get(AttachmentGetArgs),
}

#[derive(Args, Debug)]
pub struct AttachmentLsArgs {
    /// ID of the card
    pub card_id: i64,
}

#[derive(Args, Debug)]
pub struct AttachmentAddArgs {
    /// ID of the card
    pub card_id: i64,
    /// Image file to add
    #[arg(long, value_name = "PATH")]
    pub file: PathBuf,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
pub struct AttachmentGetArgs {
    /// ID of the card
    pub card_id: i64,
    /// Attachment ID
    pub attachment_id: String,
    /// New output file; an existing file is never overwritten
    #[arg(long, value_name = "PATH")]
    pub output: PathBuf,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo snapshot --json")]
pub struct SnapshotArgs {}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo workspace --json")]
pub struct WorkspaceArgs {}

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
        // The parser lets a later `--project` after the subcommand replace an
        // earlier one before it; a command must never guess which one was meant.
        Ok(_) if project_occurrences(args) > 1 => Err(SkanError::InvalidArgument {
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

impl Cli {
    /// Checks that depend on the combination of arguments, done before any
    /// board access so that a wrong command line always exits with 2.
    pub fn validate(&self) -> Result<(), SkanError> {
        let command = self.command.name();
        match (&self.command, self.project()) {
            // The read-only list of every project names no single project.
            (Command::Ls(args), Some(_)) if args.all_projects => {
                return Err(SkanError::InvalidArgument {
                    message: "ls --all-projects does not take --project.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            (Command::Ls(args), None) if args.all_projects => {}
            // `serve` shows every project, so naming one is a mistake.
            (Command::Serve(_), Some(_)) => {
                return Err(SkanError::InvalidArgument {
                    message: "serve does not take --project.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            // The hook reports a missing project itself, as a hook error that
            // does not block the agent's tool result.
            // Creating and listing projects name no project either.
            (
                Command::Project(ProjectArgs {
                    command: ProjectCommand::Create(_) | ProjectCommand::Ls,
                }),
                Some(_),
            ) => {
                return Err(SkanError::InvalidArgument {
                    message: format!(
                        "project {} does not take --project.",
                        self.project_subcommand_name()
                    ),
                    command: Some(command.to_string()),
                });
            }
            (
                Command::Project(ProjectArgs {
                    command: ProjectCommand::Create(_) | ProjectCommand::Ls,
                }),
                None,
            ) => {}
            (Command::Serve(_) | Command::Hook(_), None) => {}
            (_, None) => {
                return Err(SkanError::InvalidArgument {
                    message: "--project NAME is required.".to_string(),
                    command: Some(command.to_string()),
                });
            }
            (_, Some(_)) => {}
        }
        match &self.command {
            Command::Edit(args)
                if args.title.is_none()
                    && args.description.desc.is_none()
                    && args.description.desc_file.is_none()
                    && args.epic.is_none()
                    && !args.clear_epic =>
            {
                Err(SkanError::InvalidArgument {
                    message: "nothing to change; give --title, --desc, --desc-file, --epic, or --clear-epic.".to_string(),
                    command: Some("edit".to_string()),
                })
            }
            Command::Epic(EpicArgs {
                command: EpicCommand::Edit(args),
            }) if args.name.is_none()
                && args.color.is_none()
                && args.plan.plan.is_none()
                && args.plan.plan_file.is_none() =>
            {
                Err(SkanError::InvalidArgument {
                    message: "nothing to change; give --name, --color, --plan, or --plan-file.".to_string(),
                    command: Some("epic edit".to_string()),
                })
            }
            Command::Snapshot(_) if !self.json => Err(SkanError::InvalidArgument {
                message: "snapshot requires --json.".into(),
                command: Some("snapshot".into()),
            }),
            Command::Attachment(AttachmentArgs {
                command: AttachmentCommand::Get(args),
            }) if args.output.as_os_str().is_empty() => Err(SkanError::InvalidArgument {
                message: "--output PATH is required.".into(),
                command: Some("attachment get".into()),
            }),
            _ => Ok(()),
        }
    }
}

impl Cli {
    /// The project named with `--project`, if any. Giving the option more than
    /// once is rejected by [`parse`], so there is at most one.
    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }

    fn project_subcommand_name(&self) -> &'static str {
        match &self.command {
            Command::Project(ProjectArgs { command }) => match command {
                ProjectCommand::Create(_) => "create",
                ProjectCommand::Ls => "ls",
                ProjectCommand::Rename(_) => "rename",
                ProjectCommand::Rm => "rm",
            },
            _ => "",
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
