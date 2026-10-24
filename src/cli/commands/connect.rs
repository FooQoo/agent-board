//! `agboard connect`: the interactive setup of the Skill and the Hook for
//! Claude Code and Codex. It asks which agents, one Skill scope and one Hook
//! scope shared by all of them, shows the plan, and writes only after a "y".
//! It needs a terminal, takes no options, and never waits on a pipe.
//!
//! Exit codes: 0 for success, nothing to change, or a cancel; 1 when an agent
//! could not be configured or the folder is not bound; 2 for a bad command
//! line or no terminal.

use std::ffi::OsString;
use std::io::{BufRead, IsTerminal};
use std::path::{Path, PathBuf};

use crate::cli::Env;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::integrations::apply::{ApplyOptions, apply_all, exit_code};
use crate::integrations::assets::bundle;
use crate::integrations::detect::{Detection, detect_all};
use crate::integrations::paths::{PathEnv, registry_path, resolve_targets};
use crate::integrations::plan::{AgentPlan, PlanInput, PlanState, plan_agent};
use crate::integrations::prompt::{AgentChoice, Prompter, Reply};
use crate::integrations::recovery::recover_pending;
use crate::integrations::registry::Registry;
use crate::integrations::report;
use crate::integrations::{Agent, Component, Scope};

/// What the questions and the plan are about.
pub struct Session {
    pub path_env: PathEnv,
    /// PATH as the process has it; agents are looked up here.
    pub path_var: Option<OsString>,
    pub project_id: String,
    pub project_name: String,
    /// The nearest binding's canonical root.
    pub root: PathBuf,
}

/// Runs connect on the real terminal.
pub fn run(env: &mut Env) -> Result<i32, AgboardError> {
    if !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        return Err(AgboardError::InvalidArgument {
            message: "connect is interactive and needs a terminal; it never reads a pipe or waits for input. Run it yourself in a terminal.".to_string(),
            command: Some("connect".to_string()),
        });
    }
    let cwd =
        std::env::current_dir().map_err(|_| AgboardError::FolderUnbound { folder: ".".into() })?;
    let files = FileStore::open(&env.shared_dir);
    let Some(bound) = files.resolve_binding(&cwd)? else {
        let text = format!(
            "This folder is not bound to a project, so connect has nothing to set up.\nFolder: {}\nCreate a project here, or bind an existing one, and run connect again:\n  agboard project create \"My project\"\n  agboard project bind \"My project\"\n",
            cwd.display()
        );
        let _ = std::io::Write::write_all(env.stderr, text.as_bytes());
        return Ok(1);
    };
    let session = Session {
        path_env: PathEnv::from_process(),
        path_var: std::env::var_os("PATH"),
        project_id: bound.project.id.to_string(),
        project_name: bound.project.name,
        root: bound.bound_root,
    };
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    Ok(flow(&mut input, &mut *env.stdout, &session))
}

/// The seven steps, after the terminal and the binding are known. Returns the
/// exit code.
pub fn flow(input: &mut dyn BufRead, out: &mut dyn std::io::Write, s: &Session) -> i32 {
    let mut p = Prompter::new(input, out);
    p.say(&report::header(&s.project_name, &s.root));
    let detections = detect_all(s.path_var.as_deref());
    if detections.iter().all(|d| !d.is_available()) {
        for d in &detections {
            if let Err(reason) = &d.found {
                p.say(&format!("{}: {reason}\n", d.agent.label()));
            }
        }
        p.say("No supported agent was found on PATH. Install Claude Code or Codex and run connect again. Nothing was changed.\n");
        return 0;
    }
    let registry = match registry_path(&s.path_env).map(|path| Registry::read(&path)) {
        Ok(Ok(registry)) => registry.unwrap_or_default(),
        Ok(Err(error)) | Err(error) => {
            p.say(&format!("Error: {error}\nNothing was changed.\n"));
            return 1;
        }
    };
    let defaults = Defaults::from(&registry, &s.root);
    let Reply::Value(agents) = p.select_agents(&choices(&detections), &defaults.agents) else {
        return cancelled(&mut p);
    };
    let Reply::Value(skill) = p.select_scope("Skill", &s.root, defaults.skill) else {
        return cancelled(&mut p);
    };
    let Reply::Value(hook) = p.select_scope("Hook", &s.root, defaults.hook) else {
        return cancelled(&mut p);
    };
    let mut stopped = false;
    let plans = plan_all(&mut p, s, &agents, skill, hook, &registry, &mut stopped);
    if plans.is_empty() {
        p.say("\nSetup finished with errors.\n");
        return 1;
    }
    p.say(&report::summary(&plans));
    if plans
        .iter()
        .all(|plan| plan.state() == PlanState::Unchanged)
        && !stopped
    {
        p.say("No changes. Nothing was written.\n");
        return 0;
    }
    if plans.iter().all(|plan| plan.state() != PlanState::Ready) {
        p.say("Nothing can be applied. Nothing was written.\n");
        p.say("\nSetup finished with errors.\n");
        return 1;
    }
    if !p.confirm("Apply these changes?") {
        return cancelled(&mut p);
    }
    p.say("\n");
    let outcomes = apply_all(&s.path_env, &plans, &ApplyOptions::default());
    let code = exit_code(&outcomes).max(i32::from(stopped));
    p.say(&report::results(&outcomes, &plans, code));
    code
}

fn cancelled(p: &mut Prompter) -> i32 {
    p.say("\nCancelled. Nothing was changed.\n");
    0
}

fn choices(detections: &[Detection]) -> Vec<AgentChoice> {
    detections
        .iter()
        .map(|d| match &d.found {
            Ok(found) => AgentChoice {
                agent: d.agent,
                detail: format!(
                    "{} ({})",
                    found.version.as_deref().unwrap_or("version unknown"),
                    found.path.display()
                ),
                available: true,
            },
            Err(reason) => AgentChoice {
                agent: d.agent,
                detail: reason.clone(),
                available: false,
            },
        })
        .collect()
}

/// What a rerun offers first: the agents and scopes already recorded for this
/// project root, and Global when nothing is recorded.
struct Defaults {
    agents: Vec<Agent>,
    skill: Scope,
    hook: Scope,
}

impl Defaults {
    fn from(registry: &Registry, root: &Path) -> Defaults {
        let mine: Vec<_> = registry
            .installations
            .iter()
            .filter(|r| r.bound_root.as_deref().is_none_or(|b| b == root))
            .collect();
        let scope = |component: Component| {
            mine.iter()
                .find(|r| r.component == component)
                .map_or(Scope::Global, |r| r.scope)
        };
        Defaults {
            agents: Agent::ALL
                .into_iter()
                .filter(|a| mine.iter().any(|r| r.agent == *a))
                .collect(),
            skill: scope(Component::Skill),
            hook: scope(Component::Hook),
        }
    }
}

/// Recovers any unfinished earlier run, then plans each agent. An agent whose
/// earlier run cannot be undone, or that cannot be planned, is left out and
/// `stopped` is set.
fn plan_all(
    p: &mut Prompter,
    s: &Session,
    agents: &[Agent],
    skill: Scope,
    hook: Scope,
    registry: &Registry,
    stopped: &mut bool,
) -> Vec<AgentPlan> {
    let bundle = match bundle() {
        Ok(bundle) => bundle,
        Err(error) => {
            p.say(&format!("Error: {error}\n"));
            *stopped = true;
            return Vec::new();
        }
    };
    let mut plans = Vec::new();
    for &agent in agents {
        match recover_pending(&s.path_env, agent, None) {
            Ok(None) => {}
            Ok(Some(found)) => {
                p.say(&report::recovery(agent, &found));
                if !found.is_clean() {
                    *stopped = true;
                    continue;
                }
            }
            Err(error) => {
                p.say(&format!("{}: {error}\n", agent.label()));
                *stopped = true;
                continue;
            }
        }
        let planned =
            resolve_targets(&s.path_env, agent, skill, hook, Some(&s.root)).and_then(|targets| {
                plan_agent(&PlanInput {
                    env: &s.path_env,
                    targets: &targets,
                    project_id: Some(&s.project_id),
                    scan_root: Some(&s.root),
                    registry,
                    bundle: &bundle,
                    permissions: true,
                })
            });
        match planned {
            Ok(plan) => plans.push(plan),
            Err(error) => {
                p.say(&format!("{}: not configured; {error}\n", agent.label()));
                *stopped = true;
            }
        }
    }
    plans
}
