//! `message`: questions agents ask people, and requests people send agents.

use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};

use super::enums::ActorArg;

#[derive(Args, Debug)]
pub struct MessageArgs {
    #[command(subcommand)]
    pub command: MessageCommand,
}

#[derive(Subcommand, Debug)]
pub enum MessageCommand {
    /// Ask the user questions and wait until every one is answered
    Ask(MessageAskArgs),
    /// Wait again for questions that are already asked
    Wait(MessageWaitArgs),
    /// Record a person's answer (from the chat or the command line)
    Answer(MessageAnswerArgs),
    /// List questions and requests
    Ls(MessageLsArgs),
    /// Show one question or request
    Show(MessageShowArgs),
    /// Withdraw a question (an agent) or a request (a person)
    Withdraw(MessageWithdrawArgs),
    /// Add questions to a task's questions
    Link(MessageLinkArgs),
    /// Remove questions from a task's questions
    Unlink(MessageLinkArgs),
    /// Send a request to the agents (a person)
    Send(MessageSendArgs),
    /// Accept a request (an agent)
    Accept(MessageAcceptArgs),
}

impl MessageCommand {
    pub fn name(&self) -> &'static str {
        match self {
            MessageCommand::Ask(_) => "ask",
            MessageCommand::Wait(_) => "wait",
            MessageCommand::Answer(_) => "answer",
            MessageCommand::Ls(_) => "ls",
            MessageCommand::Show(_) => "show",
            MessageCommand::Withdraw(_) => "withdraw",
            MessageCommand::Link(_) => "link",
            MessageCommand::Unlink(_) => "unlink",
            MessageCommand::Send(_) => "send",
            MessageCommand::Accept(_) => "accept",
        }
    }
}

#[derive(Args, Debug)]
#[command(
    after_help = "Each question becomes its own message (Q-<n>). The command prints one event per line: registered first, then waiting every --heartbeat seconds, and last answered (exit 0), timeout (exit 5), withdrawn (exit 6), or error. With --json each line is JSON. A wait starts the local server in the background when none runs; --no-wait needs no server.\n\nExamples:\n  agboard --project demo message ask --actor ai --task 12 --questions-json '{\"questions\":[{\"body\":\"Which plan?\",\"choices\":[{\"id\":\"a\",\"label\":\"Plan A\"},{\"id\":\"b\",\"label\":\"Plan B\"}]}]}' --json\n  cat questions.json | agboard --project demo message ask --actor ai --questions-json - --timeout none --json\n  agboard --project demo message ask --actor ai --task 12 --questions-json - --no-wait"
)]
pub struct MessageAskArgs {
    /// Who asks: only an agent
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
    /// The questions as JSON: {"questions":[{"body","choices","recommendedChoiceId","tasks"}]}. Use - to read standard input
    #[arg(long, value_name = "JSON", required = true, allow_hyphen_values = true)]
    pub questions_json: String,
    /// A task that waits on every question; repeat for more tasks
    #[arg(long = "task", value_name = "ID")]
    pub tasks: Vec<i64>,
    /// Seconds to wait, 1 to 86400, or none to wait without a limit (default 600)
    #[arg(long, value_name = "SECONDS")]
    pub timeout: Option<String>,
    /// Seconds between waiting lines, 10 to 600
    #[arg(long, value_name = "SECONDS", default_value_t = 60, value_parser = clap::value_parser!(u64).range(10..=600))]
    pub heartbeat: u64,
    /// Ask and return at once, without waiting
    #[arg(long)]
    pub no_wait: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo message wait Q-3 Q-4 --json\n  agboard --project demo message wait Q-3 --timeout none"
)]
pub struct MessageWaitArgs {
    /// The questions that message ask registered
    #[arg(required = true, value_name = "Q-ID")]
    pub ids: Vec<String>,
    /// Seconds to wait, 1 to 86400, or none to wait without a limit (default 600)
    #[arg(long, value_name = "SECONDS")]
    pub timeout: Option<String>,
    /// Seconds between waiting lines, 10 to 600
    #[arg(long, value_name = "SECONDS", default_value_t = 60, value_parser = clap::value_parser!(u64).range(10..=600))]
    pub heartbeat: u64,
}

/// Only a person acts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum HumanActorArg {
    Human,
}

/// Only an agent acts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AiActorArg {
    Ai,
}

/// Where the person gave the answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AnswerViaArg {
    Chat,
    Cli,
}

#[derive(Args, Debug)]
#[command(
    after_help = "The first recorded answer of a question is final: answering it again fails with question_answered (exit 1) and prints the recorded answer. A question with choices needs --choice; a question without choices needs --text.\n\nExamples:\n  agboard --project demo message answer Q-12 --actor human --via chat --choice a\n  agboard --project demo message answer Q-13 --actor human --via cli --text \"Use the smaller plan.\""
)]
pub struct MessageAnswerArgs {
    /// The question to answer
    pub id: String,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum MessageStatusArg {
    Open,
    /// Answered questions and accepted requests
    Closed,
    Withdrawn,
    All,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum MessageTypeArg {
    Question,
    Request,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo message ls\n  agboard --project demo message ls --type request --status all --json\n  agboard --project demo message ls --task 12 --json"
)]
pub struct MessageLsArgs {
    /// Which messages to list
    #[arg(long, value_enum, default_value = "open")]
    pub status: MessageStatusArg,
    /// Only questions or only requests
    #[arg(long = "type", value_enum)]
    pub kind: Option<MessageTypeArg>,
    /// Only the questions this task refers to
    #[arg(long, value_name = "ID")]
    pub task: Option<i64>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo message show Q-12\n  agboard --project demo message show Q-13 --json"
)]
pub struct MessageShowArgs {
    /// A message ID (Q-12)
    pub id: String,
}

#[derive(Args, Debug)]
#[command(
    after_help = "An agent withdraws a question and a person withdraws a request. A message that has its reply cannot be withdrawn.\n\nExamples:\n  agboard --project demo message withdraw Q-12 --actor ai\n  agboard --project demo message withdraw Q-13 --actor human"
)]
pub struct MessageWithdrawArgs {
    /// The message to withdraw
    pub id: String,
    /// Who withdraws it
    #[arg(long, value_enum, required = true)]
    pub actor: ActorArg,
}

#[derive(Args, Debug)]
#[command(
    after_help = "An agent cannot change a Done, draft, or archived task.\n\nExamples:\n  agboard --project demo message link Q-12 Q-13 --task 14\n  agboard --project demo message unlink Q-12 --task 14"
)]
pub struct MessageLinkArgs {
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

#[derive(Args, Debug)]
#[command(
    after_help = "The images are stored under the request's attachments/ folder; write ![](attachments/NAME) in the text to show one.\n\nExamples:\n  agboard --project demo message send --actor human --text \"Add a reset link to the login page.\"\n  agboard --project demo message send --actor human --text-file request.md --image login.png --json"
)]
pub struct MessageSendArgs {
    /// Who sends: only a person
    #[arg(long, value_enum, required = true)]
    pub actor: HumanActorArg,
    /// The request as Markdown text
    #[arg(
        long,
        value_name = "TEXT",
        allow_hyphen_values = true,
        group = "text_source",
        required_unless_present = "text_file"
    )]
    pub text: Option<String>,
    /// Read the request from a UTF-8 file
    #[arg(long, value_name = "PATH", group = "text_source")]
    pub text_file: Option<PathBuf>,
    /// An image to attach (PNG, JPEG, WebP, or GIF); repeat for more
    #[arg(long = "image", value_name = "PATH")]
    pub images: Vec<PathBuf>,
}

#[derive(Args, Debug)]
#[command(
    after_help = "The first acceptance is final: accepting again fails with request_accepted (exit 1), so two agents never take the same request.\n\nExamples:\n  agboard --project demo message accept Q-14 --actor ai --by session-1"
)]
pub struct MessageAcceptArgs {
    /// The request to accept
    pub id: String,
    /// Who accepts: only an agent
    #[arg(long, value_enum, required = true)]
    pub actor: AiActorArg,
    /// The agent or session that accepts the request
    #[arg(long, value_name = "AGENT_ID", required = true)]
    pub by: String,
}
