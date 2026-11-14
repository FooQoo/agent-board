//! `qa`: project questions and their answers.

use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};

use super::enums::ActorArg;

#[derive(Args, Debug)]
pub struct QaArgs {
    #[command(subcommand)]
    pub command: QaCommand,
}

#[derive(Subcommand, Debug)]
pub enum QaCommand {
    /// Ask the user a set of questions and wait until every one is answered
    Ask(QaAskArgs),
    /// Wait again for a request that is already registered
    Wait(QaWaitArgs),
    /// Record a person's answer (from the chat or the command line)
    Answer(QaAnswerArgs),
    /// List questions
    Ls(QaLsArgs),
    /// Show one question, or every question of a request
    Show(QaShowArgs),
    /// Withdraw a request
    Withdraw(QaWithdrawArgs),
    /// Add questions to a task's questions
    Link(QaLinkArgs),
    /// Remove questions from a task's questions
    Unlink(QaLinkArgs),
}

impl QaCommand {
    pub fn name(&self) -> &'static str {
        match self {
            QaCommand::Ask(_) => "ask",
            QaCommand::Wait(_) => "wait",
            QaCommand::Answer(_) => "answer",
            QaCommand::Ls(_) => "ls",
            QaCommand::Show(_) => "show",
            QaCommand::Withdraw(_) => "withdraw",
            QaCommand::Link(_) => "link",
            QaCommand::Unlink(_) => "unlink",
        }
    }
}

#[derive(Args, Debug)]
#[command(
    after_help = "The command prints one event per line: registered first, then waiting every --heartbeat seconds, and last answered (exit 0), timeout (exit 5), withdrawn (exit 6), or error. With --json each line is JSON. A wait starts the local server in the background when none runs; --no-wait needs no server.\n\nExamples:\n  agboard --project demo qa ask --actor ai --task 12 --request-json '{\"questions\":[{\"question\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}]}' --json\n  cat questions.json | agboard --project demo qa ask --actor ai --request-json - --timeout none --json\n  agboard --project demo qa ask --actor ai --task 12 --request-json - --no-wait"
)]
pub struct QaAskArgs {
    /// Who asks
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
    /// The questions as JSON: {"questions":[{"kind","question","choices","recommendedChoiceId","approvingChoiceIds","tasks"}]}. Use - to read standard input
    #[arg(long, value_name = "JSON", required = true, allow_hyphen_values = true)]
    pub request_json: String,
    /// A task that waits on every question; repeat for more tasks
    #[arg(long = "task", value_name = "ID")]
    pub tasks: Vec<i64>,
    /// Seconds to wait, 1 to 86400, or none to wait without a limit (default 600)
    #[arg(long, value_name = "SECONDS")]
    pub timeout: Option<String>,
    /// Seconds between waiting lines, 10 to 600
    #[arg(long, value_name = "SECONDS", default_value_t = 60, value_parser = clap::value_parser!(u64).range(10..=600))]
    pub heartbeat: u64,
    /// Register the questions and return at once, without waiting
    #[arg(long)]
    pub no_wait: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo qa wait 3f2a... --json\n  agboard --project demo qa wait 3f2a... --timeout none"
)]
pub struct QaWaitArgs {
    /// The request ID that qa ask printed
    pub request_id: String,
    /// Seconds to wait, 1 to 86400, or none to wait without a limit (default 600)
    #[arg(long, value_name = "SECONDS")]
    pub timeout: Option<String>,
    /// Seconds between waiting lines, 10 to 600
    #[arg(long, value_name = "SECONDS", default_value_t = 60, value_parser = clap::value_parser!(u64).range(10..=600))]
    pub heartbeat: u64,
}

/// Only a person answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum HumanActorArg {
    Human,
}

/// Where the person gave the answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AnswerViaArg {
    Chat,
    Cli,
}

#[derive(Args, Debug)]
#[command(
    after_help = "The first recorded answer of a question is final: answering it again fails with question_answered (exit 1) and prints the recorded answer.\n\nExamples:\n  agboard --project demo qa answer Q-12 --actor human --via chat --choice a\n  agboard --project demo qa answer Q-13 --actor human --via cli --text \"Use the smaller plan.\"\n  agboard --project demo qa answer --actor human --via chat --answers-json '{\"answers\":[{\"id\":\"Q-12\",\"choiceId\":\"a\"},{\"id\":\"Q-13\",\"text\":\"Later.\"}]}'"
)]
pub struct QaAnswerArgs {
    /// The question to answer; omit it with --answers-json
    pub question_id: Option<String>,
    /// Who answers: only a person
    #[arg(long, value_enum, required = true)]
    pub actor: HumanActorArg,
    /// Where the person answered
    #[arg(long, value_enum, required = true)]
    pub via: AnswerViaArg,
    /// The chosen option (its ID)
    #[arg(long, value_name = "CHOICE_ID")]
    pub choice: Option<String>,
    /// A written answer
    #[arg(
        long,
        value_name = "TEXT",
        allow_hyphen_values = true,
        group = "text_source"
    )]
    pub text: Option<String>,
    /// Read the written answer from a UTF-8 file
    #[arg(long, value_name = "PATH", group = "text_source")]
    pub text_file: Option<PathBuf>,
    /// Several answers as JSON: {"answers":[{"id","choiceId","text"}]}, written together or not at all. Use - to read standard input
    #[arg(long, value_name = "JSON", allow_hyphen_values = true)]
    pub answers_json: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum QaStatusArg {
    Open,
    Answered,
    Withdrawn,
    All,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo qa ls\n  agboard --project demo qa ls --status all --task 12 --json"
)]
pub struct QaLsArgs {
    /// Which questions to list
    #[arg(long, value_enum, default_value = "open")]
    pub status: QaStatusArg,
    /// Only the questions this task refers to
    #[arg(long, value_name = "ID")]
    pub task: Option<i64>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo qa show Q-12\n  agboard --project demo qa show 3f2a... --json"
)]
pub struct QaShowArgs {
    /// A question ID (Q-12) or a request ID
    pub id: String,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo qa withdraw 3f2a... --actor ai --reason \"The plan changed.\""
)]
pub struct QaWithdrawArgs {
    /// The request to withdraw
    pub request_id: String,
    /// Who withdraws it
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
    /// Why, up to 2,000 characters
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub reason: Option<String>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "An agent cannot change a Done, draft, or archived task.\n\nExamples:\n  agboard --project demo qa link Q-12 Q-13 --task 14\n  agboard --project demo qa unlink Q-12 --task 14"
)]
pub struct QaLinkArgs {
    /// The questions
    #[arg(required = true, value_name = "Q-ID")]
    pub ids: Vec<String>,
    /// The task whose questions change
    #[arg(long, value_name = "ID", required = true)]
    pub task: i64,
    /// Who makes the change (default ai)
    #[arg(long, value_enum, default_value = "ai")]
    pub actor: ActorArg,
}
