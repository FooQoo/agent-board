//! Arguments of the agent and server commands: `progress`, `hook`, `wait`,
//! `setup`, `connect`, `update`, `serve`, and `stop`.

use clap::{Args, ValueEnum};

use crate::domain::ChangeCursor;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AgentArg {
    Claude,
    Codex,
}

/// Extra sections for the progress table, shared by `progress` and `hook`.
#[derive(Args, Debug, Clone, Copy, Default)]
pub struct ProgressArgs {
    /// Also list the tasks waiting for a decision, with their questions
    #[arg(long)]
    pub include_pending: bool,
    /// Also list this many of the most recently completed tasks
    #[arg(long, value_name = "COUNT", default_value_t = 0)]
    pub include_done: usize,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard hook --agent claude\n  agboard hook --agent codex\n  agboard --project demo hook --agent claude"
)]
pub struct HookArgs {
    #[arg(long, value_enum)]
    pub agent: AgentArg,
    #[command(flatten)]
    pub progress: ProgressArgs,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard --project demo wait --after f1:0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef --json\n  agboard --project demo wait --after f1:0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef --timeout 60 --json\n  agboard --project demo wait --until task --idle-timeout 300 --json"
)]
pub struct WaitArgs {
    /// Cursor to wait after, as printed by snapshot: f1:<project-id>:<version>
    #[arg(long, value_name = "CURSOR", value_parser = parse_cursor, conflicts_with_all = ["until", "idle_timeout"])]
    pub after: Option<ChangeCursor>,
    /// Maximum time to wait for a board change; only with --after
    #[arg(long, requires = "after", conflicts_with_all = ["until", "idle_timeout"])]
    pub timeout: Option<u64>,
    /// Wait for the next eligible task
    #[arg(long, value_enum, conflicts_with_all = ["after", "timeout"])]
    pub until: Option<WaitUntilArg>,
    /// Seconds with no eligible task before normal idle completion (1..86400)
    #[arg(long, value_name = "SECONDS", value_parser = clap::value_parser!(u64).range(1..=86400), requires = "until")]
    pub idle_timeout: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum WaitUntilArg {
    Task,
}

fn parse_cursor(text: &str) -> Result<ChangeCursor, String> {
    text.parse::<ChangeCursor>().map_err(|e| e.reason())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum SetupAgentArg {
    Codex,
    Claude,
    All,
}

/// `connect` takes no options: it is an interactive first-time setup.
#[derive(Args, Debug)]
pub struct ConnectArgs {}

/// `update` refreshes what connect installed. It keeps the recorded agents
/// and scopes, so it has one option.
#[derive(Args, Debug)]
pub struct UpdateArgs {
    /// Skip the confirmation question; conflicts still stop the update
    #[arg(long)]
    pub yes: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard setup\n  agboard setup --agent codex --dry-run\n  agboard setup --agent claude --json"
)]
pub struct SetupArgs {
    /// Agent whose user settings are updated
    #[arg(long, value_enum, default_value = "all")]
    pub agent: SetupAgentArg,
    /// Show the planned changes; create and change nothing
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard serve\n  agboard serve --port 7500\n  agboard serve -d\n  agboard stop\n  NGROK_AUTHTOKEN=... agboard serve --monitor ngrok"
)]
pub struct ServeArgs {
    /// Port to listen on (127.0.0.1 only)
    #[arg(long, value_name = "PORT", default_value_t = 7420)]
    pub port: u16,
    /// Built-in mobile monitor connection; ngrok is the only mode (a 4-digit passcode is printed at startup)
    #[arg(long, value_name = "MODE")]
    pub monitor: Option<String>,
    /// Run in the background and return once the server is ready; stop it with `agboard stop`. Output goes to serve.log in the data directory
    #[arg(short = 'd', long)]
    pub daemon: bool,
}

#[derive(Args, Debug)]
pub struct StopArgs {}
