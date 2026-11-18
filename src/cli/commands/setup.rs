//! `agboard setup` and `agboard update` on the command line.
//!
//! On a terminal the agents are chosen with a cliclack prompt (for setup,
//! when `--agent` is not given), the plan is shown, and nothing happens until
//! the user answers yes. The question names the Codex hook trust when the
//! plan includes it. `--yes` answers it in advance. Without a terminal, or
//! with `--json`, nothing is asked: setup needs `--agent`, and both commands
//! need `--yes` or `--dry-run`, so a script never waits for input.
//!
//! Exit codes: 0 for success, a cancel, or nothing to do; 1 when an agent
//! failed or setup could set up no agent; 2 for a bad command line.

use std::io::IsTerminal;

use crate::cli::args::SetupAgentArg;
use crate::error::AgboardError;
use crate::setup::{self, Agent, Mode, SetupEnv, SetupOptions, SetupReport};

/// What the command line asked for; the same for both commands.
pub struct Request {
    pub mode: Mode,
    pub agent: Option<SetupAgentArg>,
    pub yes: bool,
    pub dry_run: bool,
    /// Started by the hook; see `setup::auto_update`.
    pub background: bool,
    pub json: bool,
}

/// What a run printed and its exit code.
pub enum Finished {
    Report(SetupReport),
    Cancelled,
}

pub fn run(request: &Request) -> Result<Finished, AgboardError> {
    if request.background {
        let agent = match request.agent {
            Some(SetupAgentArg::Codex) => Agent::Codex,
            _ => Agent::Claude,
        };
        let env = SetupEnv::from_process();
        return Ok(match setup::auto_update::run_background(&env, agent) {
            Some(report) => Finished::Report(report),
            None => Finished::Cancelled,
        });
    }
    let terminal = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    let interactive = terminal && !request.json;
    let command = request.mode.command();
    if !interactive {
        if request.mode == Mode::Setup && request.agent.is_none() {
            return Err(invalid(
                command,
                "setup asks which agent to set up and needs a terminal for it. Without a terminal or with --json, add --agent codex, claude, or all.",
            ));
        }
        if !request.yes && !request.dry_run {
            return Err(invalid(
                command,
                &format!(
                    "{command} asks for a confirmation and needs a terminal for it; it never reads a pipe. Add --yes to agree in advance (this includes trusting the Agent Board plugin's hooks in Codex), or --dry-run to see the plan."
                ),
            ));
        }
    }
    let env = SetupEnv::from_process();
    let agents = match request.agent {
        Some(SetupAgentArg::Codex) => vec![Agent::Codex],
        Some(SetupAgentArg::Claude) => vec![Agent::Claude],
        Some(SetupAgentArg::All) => Agent::ALL.to_vec(),
        None if request.mode == Mode::Update => Agent::ALL.to_vec(),
        None => match choose_agents(&env) {
            Some(agents) => agents,
            None => return Ok(Finished::Cancelled),
        },
    };
    let options = SetupOptions {
        mode: request.mode,
        agents,
        dry_run: request.dry_run,
    };
    let prepared = setup::prepare(&env, &options)?;
    if interactive && !request.dry_run && !request.yes && prepared.has_work() {
        let _ = cliclack::note(format!("agboard {command}"), prepared.describe());
        let question = if prepared.trusts_hooks() {
            "Apply these changes? This also marks the Agent Board plugin's hooks as trusted in Codex, so Codex runs them without asking."
        } else {
            "Apply these changes?"
        };
        match cliclack::confirm(question).initial_value(true).interact() {
            Ok(true) => {}
            _ => {
                let _ = cliclack::outro_cancel("Nothing was changed.");
                return Ok(Finished::Cancelled);
            }
        }
    }
    Ok(Finished::Report(setup::execute(prepared)?))
}

/// Asks which agents to set up, among those whose command is on `PATH`.
/// `None` when the user cancels.
fn choose_agents(env: &SetupEnv) -> Option<Vec<Agent>> {
    let _ = cliclack::intro("agboard setup");
    let found: Vec<Agent> = setup::available(env)
        .into_iter()
        .filter_map(|(agent, program)| {
            if program.is_none() {
                let _ = cliclack::log::remark(format!(
                    "{}: the {} command was not found on PATH",
                    agent.label(),
                    agent.key()
                ));
            }
            program.map(|_| agent)
        })
        .collect();
    match found.as_slice() {
        // Nothing to choose: the run reports each agent as skipped.
        [] => Some(Agent::ALL.to_vec()),
        [one] => {
            let _ = cliclack::log::info(format!("Setting up {}.", one.label()));
            Some(vec![*one])
        }
        _ => {
            let both = "both";
            let picked = cliclack::select("Which agent do you use with Agent Board?")
                .item("codex", "Codex", "")
                .item("claude", "Claude Code", "")
                .item(both, "Both", "Codex and Claude Code")
                .initial_value(both)
                .interact()
                .ok()?;
            Some(match picked {
                "codex" => vec![Agent::Codex],
                "claude" => vec![Agent::Claude],
                _ => Agent::ALL.to_vec(),
            })
        }
    }
}

fn invalid(command: &str, message: &str) -> AgboardError {
    AgboardError::InvalidArgument {
        message: message.to_string(),
        command: Some(command.to_string()),
    }
}
