//! The planning phase: what a run would do, found without changing anything.
//! The agents' plugin lists are read (a read-only command), and the settings
//! files are read and planned. An agent whose command is missing is skipped
//! with the reason; a settings file that cannot be used stops the whole run.

use std::path::PathBuf;

use super::agent_cli;
use super::plan::{self, Target};
use super::plugin::{self, Source};
use super::{Agent, Mode, SetupEnv, SetupOptions, VERSION, env};
use crate::error::AgboardError;

/// Everything a run would do, before anything is done.
#[derive(Debug)]
pub struct Prepared {
    pub mode: Mode,
    pub dry_run: bool,
    pub data_dir: PathBuf,
    pub shared_dir: PathBuf,
    pub agents: Vec<AgentPlan>,
    /// A folder for the commands that need one (the data directory once it
    /// exists, else the home directory).
    pub work_dir: Option<PathBuf>,
}

/// One agent's part of the plan.
#[derive(Debug)]
pub struct AgentPlan {
    pub agent: Agent,
    /// The agent's command, when it was found on `PATH`.
    pub program: Option<PathBuf>,
    /// Why nothing is done for this agent (the command is missing, or update
    /// finds no plugin to update).
    pub skipped: Option<String>,
    /// Why this agent cannot be set up (its plugin list could not be read).
    pub failed: Option<String>,
    pub source: Source,
    /// The plugin version installed now; `None` when it is not installed.
    pub installed: Option<String>,
    /// Whether the plugin is installed or moved to this version.
    pub install: bool,
    /// Whether the plugin's hooks are trusted (Codex only).
    pub trust: bool,
    pub targets: Vec<Target>,
    /// Steps the user has to take by hand.
    pub manual: Vec<String>,
}

impl AgentPlan {
    /// Whether this agent takes part in the run.
    pub fn active(&self) -> bool {
        self.skipped.is_none() && self.failed.is_none()
    }

    /// The files this run would change.
    pub fn changed_targets(&self) -> impl Iterator<Item = &Target> {
        self.targets
            .iter()
            .filter(|target| target.planned.is_some())
    }
}

/// Each agent and its command, when found on `PATH`.
pub fn available(env: &SetupEnv) -> Vec<(Agent, Option<PathBuf>)> {
    Agent::ALL
        .into_iter()
        .map(|agent| {
            let program = agent_cli::find_on_path(agent.key(), env.path_var.as_deref());
            (agent, program)
        })
        .collect()
}

/// Plans a run. Fails only when the data directory cannot be resolved or a
/// settings file cannot be used, before anything is written.
pub fn prepare(env: &SetupEnv, options: &SetupOptions) -> Result<Prepared, AgboardError> {
    let data_dir = env.data_dir()?;
    let root = data_dir
        .to_str()
        .ok_or_else(|| AgboardError::BoardUnavailable {
            reason: "The data directory path is not UTF-8. Set AGBOARD_HOME to a UTF-8 path."
                .into(),
        })?
        .to_string();
    let shared_dir = data_dir.join("shared");
    let mut agents = Vec::new();
    for agent in Agent::ALL {
        if options.agents.contains(&agent) {
            agents.push(plan_agent(env, options.mode, agent, &root)?);
        }
    }
    Ok(Prepared {
        mode: options.mode,
        dry_run: options.dry_run,
        data_dir,
        shared_dir,
        agents,
        work_dir: env.work_dir(),
    })
}

fn plan_agent(
    env: &SetupEnv,
    mode: Mode,
    agent: Agent,
    root: &str,
) -> Result<AgentPlan, AgboardError> {
    let override_location = env.marketplace_override();
    let forced = override_location.is_some();
    let mut planned = AgentPlan {
        agent,
        program: agent_cli::find_on_path(agent.key(), env.path_var.as_deref()),
        skipped: None,
        failed: None,
        source: Source::for_version(VERSION, override_location),
        installed: None,
        install: false,
        trust: false,
        targets: Vec::new(),
        manual: Vec::new(),
    };
    let Some(program) = planned.program.clone() else {
        planned.skipped = Some(format!(
            "The {} command was not found on PATH. Install {}, then run agboard {} again.",
            agent.key(),
            agent.label(),
            mode.command()
        ));
        return Ok(planned);
    };
    let current = match plugin::installed(agent, &program) {
        Ok(installed) => {
            let current = installed
                .as_ref()
                .is_some_and(plugin::Installed::is_current);
            planned.installed = installed.map(|plugin| plugin.version);
            current
        }
        Err(reason) => {
            planned.failed = Some(reason);
            return Ok(planned);
        }
    };
    match mode {
        Mode::Update if planned.installed.is_none() => {
            planned.skipped = Some(format!(
                "The Agent Board plugin is not installed in {}. Run agboard setup to install it.",
                agent.label()
            ));
            return Ok(planned);
        }
        Mode::Update => planned.install = true,
        Mode::Setup => {
            planned.install = forced || !current;
            plan_files(env, agent, root, &mut planned)?;
        }
    }
    planned.trust = agent == Agent::Codex;
    Ok(planned)
}

fn plan_files(
    env: &SetupEnv,
    agent: Agent,
    root: &str,
    planned: &mut AgentPlan,
) -> Result<(), AgboardError> {
    let config = match agent {
        Agent::Codex => env.codex_config()?,
        Agent::Claude => env.claude_settings()?,
    };
    let settings = plan::plan(agent, &config, root)?;
    planned.targets.push(settings.target);
    planned.manual.extend(settings.manual);
    if agent == Agent::Codex && !settings.full_access {
        planned.targets.push(plan::plan_rules(&env.codex_rules()?)?);
    }
    Ok(())
}

impl Prepared {
    /// The plan for a person, shown before the confirmation question.
    pub fn describe(&self) -> String {
        let mut text = format!("Data directory: {}\n", env::display(&self.data_dir));
        for plan in &self.agents {
            text.push_str(&format!("\n{}\n", plan.agent.label()));
            if let Some(reason) = plan.skipped.as_ref().or(plan.failed.as_ref()) {
                text.push_str(&format!("  skipped: {reason}\n"));
                continue;
            }
            text.push_str(&format!("  plugin: {}\n", plugin_line(plan)));
            for target in plan.changed_targets() {
                text.push_str(&format!("  {}\n", env::display(&target.config_path)));
                for change in &target.changes {
                    text.push_str(&format!("    - {change}\n"));
                }
            }
            if plan.trust {
                text.push_str("  hooks: mark the Agent Board plugin's hooks as trusted in Codex\n");
            }
            for step in &plan.manual {
                text.push_str(&format!("  manual step: {step}\n"));
            }
        }
        text
    }

    /// Whether the plan trusts hooks, which the confirmation question names.
    pub fn trusts_hooks(&self) -> bool {
        self.agents.iter().any(|plan| plan.active() && plan.trust)
    }

    /// Whether any agent takes part.
    pub fn has_work(&self) -> bool {
        self.agents.iter().any(AgentPlan::active)
    }
}

/// What happens to the plugin, in one line.
pub(super) fn plugin_line(plan: &AgentPlan) -> String {
    let source = plan.source.describe();
    match (&plan.installed, plan.install) {
        (_, false) => format!("version {VERSION} is installed"),
        (None, true) => format!("install version {VERSION} from {source}"),
        (Some(old), true) if old == VERSION => format!("reinstall version {VERSION} from {source}"),
        (Some(old), true) => format!("update version {old} to {VERSION} from {source}"),
    }
}
