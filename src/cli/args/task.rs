//! Arguments of the task commands: `init`, `add`, `edit`, `mv`, `state`, `rm`,
//! `ls`, `show`, `snapshot`, and `workspace`.

use std::io::Read;
use std::path::PathBuf;

use clap::Args;

use super::enums::{ActorArg, AssigneeArg, ColumnArg, ReportStateArg, RunStateArg};
use super::history::ChangeArgs;
use crate::error::{AgboardError, FileAction};

/// The three mutually exclusive ways to give a description. On edit, the
/// current TASK.md history is retained regardless of history in this input.
#[derive(Args, Debug, Clone, Default)]
#[group(id = "description_source", multiple = false)]
pub struct DescriptionArgs {
    /// Whole TASK.md text in Markdown, frontmatter included, up to 50,000 body characters; on edit, latest history is retained; use "-" for standard input
    #[arg(long, value_name = "TEXT")]
    pub desc: Option<String>,
    /// Read the whole TASK.md text, frontmatter included (up to 50,000 body characters), from a file; on edit, latest history is retained
    #[arg(long, value_name = "PATH")]
    pub desc_file: Option<PathBuf>,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project \"My project\" init")]
pub struct InitArgs {}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo add \"Write the setup guide\" --assignee ai --actor ai\n  agboard --project demo add \"Fix the login bug\" --desc \"Users cannot sign in on Safari\" --assignee ai --actor ai\n  agboard --project demo add \"Plan the release\" --desc-file notes.txt --assignee ai --actor ai\n  echo \"Details\" | agboard --project demo add \"Write the docs\" --desc - --assignee ai --actor ai"
)]
pub struct AddArgs {
    /// Title of the task (1 to 100 characters, one line)
    pub title: String,
    #[command(flatten)]
    pub description: DescriptionArgs,
    /// Who owns this task
    #[arg(long, value_enum)]
    pub assignee: AssigneeArg,
    /// Who is creating this task
    #[arg(long, value_enum)]
    pub actor: ActorArg,
    /// Epic to put the task in (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID")]
    pub epic: Option<String>,
    /// Create the task in the Backlog: a settled plan that must not be started until a person sends it to Todo (for a request for the plan only)
    #[arg(long)]
    pub backlog: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "A task a person is drafting (draft: human) is read-only for agents: edit fails with task_is_draft (exit code 1) and changes nothing. Wait for the user to finalize it, then try again. A task you created in the Backlog can be edited by you; only a person sends it to Todo.\n\nExamples:\n  agboard --project demo edit 15 --title \"Write the install guide\"\n  agboard --project demo edit 15 --desc \"Steps for macOS and Linux\"\n  agboard --project demo edit 15 --desc \"\""
)]
pub struct EditArgs {
    /// ID of the task
    pub id: i64,
    /// New title
    #[arg(long, value_name = "TITLE")]
    pub title: Option<String>,
    #[command(flatten)]
    pub description: DescriptionArgs,
    /// Put the task in this epic (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID", conflicts_with = "clear_epic")]
    pub epic: Option<String>,
    /// Take the task out of its epic
    #[arg(long, conflicts_with = "epic")]
    pub clear_epic: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "A draft task (draft: human or ai) is read-only for agents here: mv fails with task_is_draft (exit code 1). Wait for the user to finalize or start it.\n\nExamples:\n  agboard --project demo mv 12 doing --actor ai --reason \"Starting\"\n  agboard --project demo mv 12 done --actor ai --reason \"Finished\""
)]
pub struct MvArgs {
    /// ID of the task
    pub id: i64,
    /// Column to move the task to
    pub column: ColumnArg,
    #[command(flatten)]
    pub change: ChangeArgs,
}

#[derive(Args, Debug)]
#[command(
    after_help = "A draft task (draft: human or ai) is read-only for agents here: state fails with task_is_draft (exit code 1). Wait for the user to finalize or start it.\n\nRun states:\n  idle     not working on it\n  running  you are working on it now\n\nTo ask the user, use message ask. While a task waits for answers, state running by an agent fails with questions_unanswered (exit code 1).\n\nExamples:\n  agboard --project demo state 12 running --actor ai --reason \"Working\"\n  agboard --project demo state 12 idle --actor ai --reason \"Ready for review\""
)]
pub struct StateArgs {
    /// ID of the task
    pub id: i64,
    /// Run state to report: idle or running
    pub state: ReportStateArg,
    /// Optional explanation. Use - to read UTF-8 from stdin
    #[arg(long, value_name = "TEXT", group = "reason_source")]
    pub reason: Option<String>,
    /// Read the explanation from a UTF-8 file
    #[arg(long, value_name = "PATH", group = "reason_source")]
    pub reason_file: Option<PathBuf>,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Sending is the only operation that hands a plan over to be worked on; saving, answering, and checking conditions never do. Only a person sends a Backlog task: an agent is refused with human_only. When a question about the task is still open, the send is refused with send_with_open_questions until the person confirms with --force. A task that is not in the Backlog changes nothing. A task a person is editing is refused with task_is_draft.\n\nExamples:\n  agboard --project demo send 12 --actor human\n  agboard --project demo send 12 --actor human --force"
)]
pub struct SendArgs {
    /// ID of the Backlog task to send to Todo
    pub id: i64,
    /// Who is making this change
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
    /// Send even though a question about the task is open
    #[arg(long)]
    pub force: bool,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo rm 11")]
pub struct RmArgs {
    /// ID of the task
    pub id: i64,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo ls\n  agboard --project demo ls --column doing\n  agboard --project demo ls --state pending --json\n  agboard ls --all-projects\n  agboard ls --all-projects --state pending --json"
)]
pub struct LsArgs {
    /// List the tasks of every project, read-only; do not give --project
    #[arg(long)]
    pub all_projects: bool,
    /// Only list tasks in this column
    #[arg(long, value_name = "COLUMN")]
    pub column: Option<ColumnArg>,
    /// Only list tasks with this run state
    #[arg(long, value_name = "STATE")]
    pub state: Option<RunStateArg>,
    /// Only list tasks in this epic (its EPIC-ID)
    #[arg(long, value_name = "EPIC-ID")]
    pub epic: Option<String>,
}

#[derive(Args, Debug)]
#[command(
    args_conflicts_with_subcommands = true,
    after_help = "Examples:\n  agboard --project demo show 12\n  agboard --project demo show 12 --json\n  agboard show remote\n  agboard --project demo show remote --json"
)]
pub struct ShowArgs {
    /// ID of the task
    #[arg(value_name = "ID")]
    pub id: Option<i64>,
    #[command(subcommand)]
    pub command: Option<ShowCommand>,
}

#[derive(clap::Subcommand, Debug)]
pub enum ShowCommand {
    /// Show the saved ngrok settings and the connection state; with --project and a ready connection, also the phone URL and passcode
    #[command(
        after_help = "Without --project it prints the saved settings (enabled, fixed domain, whether a token is saved in the keychain, whether the keychain is available) and the connection state of the running server. The token is never shown.\nWith --project NAME it is what you give a person who wants to open that project on a phone: the URL and the 4-digit passcode of the ready connection. Nothing is started: without a ready connection it prints the reason and exits 1 as remote_unavailable.\nThe passcode is printed only here, on this computer. Anyone who gets it can open the board while the connection is up.\nChange the settings with \"agboard setup remote\".\n\nExamples:\n  agboard show remote\n  agboard show remote --json\n  agboard --project \"My project\" show remote\n  agboard --project \"My project\" show remote --json"
    )]
    Remote,
}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo snapshot --json")]
pub struct SnapshotArgs {}

#[derive(Args, Debug)]
#[command(after_help = "Examples:\n  agboard --project demo workspace --json")]
pub struct WorkspaceArgs {}

impl DescriptionArgs {
    /// The description the user asked for: `None` when no option was given.
    /// `--desc -` reads `stdin` to the end. One trailing newline from a file
    /// or from standard input is dropped, since editors and `echo` add it.
    pub fn resolve(&self, stdin: &mut dyn Read) -> Result<Option<String>, AgboardError> {
        if let Some(text) = &self.desc {
            if text != "-" {
                return Ok(Some(text.clone()));
            }
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
        if let Some(path) = &self.desc_file {
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

pub(super) fn strip_final_newline(mut text: String) -> String {
    if text.ends_with('\n') {
        text.pop();
        if text.ends_with('\r') {
            text.pop();
        }
    }
    text
}
