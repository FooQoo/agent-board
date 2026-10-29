//! Arguments of the task commands: `init`, `add`, `edit`, `mv`, `state`, `rm`,
//! `ls`, `show`, `snapshot`, and `workspace`.

use std::io::Read;
use std::path::PathBuf;

use clap::Args;

use super::enums::{ActorArg, AssigneeArg, ColumnArg, RunStateArg};
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
    after_help = "A draft task (isDraft) is read-only for agents: edit fails with task_is_draft (exit code 1) and changes nothing. Wait for the user to finalize it, then try again.\n\nExamples:\n  agboard --project demo edit 15 --title \"Write the install guide\"\n  agboard --project demo edit 15 --desc \"Steps for macOS and Linux\"\n  agboard --project demo edit 15 --desc \"\""
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
    after_help = "A draft task (isDraft) is read-only for agents: mv fails with task_is_draft (exit code 1). Wait for the user to finalize it.\n\nExamples:\n  agboard --project demo mv 12 doing\n  agboard --project demo mv 12 done"
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
    after_help = "A draft task (isDraft) is read-only for agents: state fails with task_is_draft (exit code 1). Wait for the user to finalize it.\n\nRun states:\n  idle     not working on it, or an answer to a pending request\n  running  you are working on it now\n  pending  you are waiting for a decision (an AI task in todo or doing): ask with --request-json (a question and 2 to 10 choices); the command waits for the answer unless --no-wait\n\nExamples:\n  agboard --project demo state 12 running --actor ai --reason \"Working\"\n  agboard --project demo state 12 pending --actor ai --request-json '{\"question\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}'   # ask, then wait for the answer (needs agboard serve)\n  cat question.json | agboard --project demo state 12 pending --actor ai --request-json -\n  agboard --project demo state 12 pending --actor ai --request-json '{\"question\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}' --no-wait   # register the question and return at once\n  agboard --project demo state 12 pending --actor ai --request-json '{\"question\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}],\"wait\":{\"timeoutSeconds\":600}}'   # wait up to 10 minutes\n  agboard --project demo state 12 idle --actor human --request ID --choice a\n  agboard --project demo state 12 idle --actor human --request ID --reason \"Go ahead.\""
)]
pub struct StateArgs {
    /// ID of the task
    pub id: i64,
    /// Run state to report
    pub state: RunStateArg,
    /// Optional explanation for running and idle; the question of a pending state goes in --request-json. Use - to read UTF-8 from stdin
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
    /// A pending request as JSON: {"question": "...", "choices": [{"id": "...", "label": "..."}]} with 2 to 10 choices. The command then waits for the answer, which needs a running agboard serve; "wait": {"timeoutSeconds": 1 to 86400} limits the wait. Use - to read the JSON from standard input
    #[arg(long, value_name = "JSON")]
    pub request_json: Option<String>,
    /// Only with a pending --request-json: register the question and return at once, without waiting for the answer or a running agboard serve
    #[arg(long)]
    pub no_wait: bool,
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
