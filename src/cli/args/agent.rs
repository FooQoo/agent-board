//! Arguments of the agent and server commands: `progress`, `hook`, `wait`,
//! `setup`, `update`, `serve`, and `stop`.

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

/// `skills` prints the Agent Board Skill, or one of its topics.
#[derive(Args, Debug)]
#[command(
    after_help = "Prints the instructions of the agent-board Skill as Markdown. The plugin's SKILL.md runs this command, so the instructions always match this agboard.\nNothing is read or written, and no server is started.\n\nExamples:\n  agboard skills\n  agboard skills file-format"
)]
pub struct SkillsArgs {
    /// A part of the Skill to print instead of the main text; an unknown topic lists the topics
    #[arg(value_name = "TOPIC")]
    pub topic: Option<String>,
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
    /// Accepted and ignored, so the Hook command of an older plugin still works
    #[arg(long, value_name = "VERSION", hide = true)]
    pub plugin_version: Option<String>,
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

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard setup\n  agboard setup --agent codex --dry-run\n  agboard setup --agent claude --yes --json"
)]
pub struct SetupArgs {
    /// Agent to set up; asked on a terminal when omitted
    #[arg(long, value_enum)]
    pub agent: Option<SetupAgentArg>,
    /// Skip the confirmation question, including the one for Codex hook trust
    #[arg(long)]
    pub yes: bool,
    /// Show the planned changes; install, create, and change nothing
    #[arg(long)]
    pub dry_run: bool,
}

/// `update` moves the installed plugin to this version.
#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard update\n  agboard update --dry-run\n  agboard update --agent codex --yes"
)]
pub struct UpdateArgs {
    /// Agent whose plugin is updated; every agent with the plugin when omitted
    #[arg(long, value_enum)]
    pub agent: Option<SetupAgentArg>,
    /// Skip the confirmation question, including the one for Codex hook trust
    #[arg(long)]
    pub yes: bool,
    /// Show the planned update; change nothing
    #[arg(long)]
    pub dry_run: bool,
    /// Started by the hook: reinstall in the background without asking and
    /// without trusting Codex hooks. Not for people.
    #[arg(long, hide = true, requires = "agent", conflicts_with = "dry_run")]
    pub background: bool,
}

#[derive(Args, Debug)]
#[command(
    after_help = "Examples:\n  agboard serve\n  agboard serve --port 7500\n  agboard serve -d\n  agboard stop\n  NGROK_AUTHTOKEN=... agboard serve --monitor ngrok"
)]
pub struct ServeArgs {
    /// Port to listen on (127.0.0.1 only) [default: 7420]
    #[arg(long, value_name = "PORT")]
    pub port: Option<u16>,
    /// Built-in remote access connection; ngrok is the only mode (a 4-digit passcode is printed at startup)
    #[arg(long, value_name = "MODE")]
    pub monitor: Option<String>,
    /// Run in the background and return once the server is ready; stop it with `agboard stop`. Output goes to serve.log in the data directory
    #[arg(short = 'd', long)]
    pub daemon: bool,
    /// Started by another command that needed a server: prefer the default
    /// port, and stop after a time without use. Not for people.
    #[arg(long, hide = true, conflicts_with_all = ["port", "monitor", "daemon"])]
    pub auto: bool,
    /// With --auto: the project whose board to open in the browser once the
    /// server is ready. Not for people.
    #[arg(long, hide = true, value_name = "PROJECT_ID", requires = "auto")]
    pub open_board: Option<String>,
}

impl ServeArgs {
    /// The port a manual server listens on.
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(crate::autostart::DEFAULT_PORT)
    }
}

#[derive(Args, Debug)]
pub struct StopArgs {}

#[derive(Args, Debug)]
pub struct RemoteArgs {}

#[derive(Args, Debug)]
#[command(
    after_help = "The project is the one bound to the current folder unless --project names one.\nThe server is started in the background when none runs.\n\nExamples:\n  agboard open\n  agboard --project \"My project\" open\n  agboard open --print\n  agboard open --json"
)]
pub struct OpenArgs {
    /// Print the board's address without opening the browser
    #[arg(long)]
    pub print: bool,
}
