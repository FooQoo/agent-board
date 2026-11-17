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
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
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
    after_help = "Examples:\n  agboard --project demo add \"Write the setup guide\"\n  agboard --project demo add \"Fix the login bug\" --desc \"Users cannot sign in on Safari\"\n  agboard --project demo add \"Plan the release\" --desc-file notes.txt\n  echo \"Details\" | agboard --project demo add \"Write the docs\" --desc -"
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
}

#[derive(Args, Debug)]
#[command(
    after_help = "A task a person is drafting (draft: human) is read-only for agents: edit fails with task_is_draft (exit code 1) and changes nothing. Wait for the user to finalize it, then try again. A task you created is an AI draft (draft: ai): you can edit it, and a person starts it.\n\nExamples:\n  agboard --project demo edit 15 --title \"Write the install guide\"\n  agboard --project demo edit 15 --desc \"Steps for macOS and Linux\"\n  agboard --project demo edit 15 --desc \"\""
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
    after_help = "A draft task (draft: human or ai) is read-only for agents here: mv fails with task_is_draft (exit code 1). Wait for the user to finalize or start it.\n\nExamples:\n  agboard --project demo mv 12 doing\n  agboard --project demo mv 12 done"
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
    after_help = "A draft task (draft: human or ai) is read-only for agents here: state fails with task_is_draft (exit code 1). Wait for the user to finalize or start it.\n\nRun states:\n  idle     not working on it\n  running  you are working on it now\n\nTo ask the user, use qa ask. While a task waits for answers, state running by an agent fails with questions_unanswered (exit code 1).\n\nExamples:\n  agboard --project demo state 12 running --actor ai --reason \"Working\"\n  agboard --project demo state 12 idle --actor ai --reason \"Ready for review\""
)]
pub struct StateArgs {
    /// ID of the task
    pub id: i64,
    /// Run state to report: idle or running
    pub state: ReportStateArg,
    /// Optional explanation. Use - to read UTF-8 from stdin
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

#[derive(Args, Debug)]
#[command(
    after_help = "Only a person may start. With --actor ai the command fails with human_only (exit code 1). A task that is not an AI draft changes nothing.\n\nExamples:\n  agboard --project demo start 12 --actor human"
)]
pub struct StartArgs {
    /// ID of the task whose AI draft a person starts
    pub id: i64,
    /// Who is making this change; only human can start
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
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
    after_help = "Examples:\n  agboard --project demo show 12\n  agboard --project demo show 12 --json"
)]
pub struct ShowArgs {
    /// ID of the task
    pub id: i64,
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
