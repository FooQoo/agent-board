//! `agboard update`: refreshes the Skill and Hook that connect installed.
//! It keeps the recorded agents and scopes, asks y/N after showing what would
//! change (`--yes` skips only that question), and never overwrites a change
//! the user made.
//!
//! Exit codes: 0 for success, nothing to update, or a cancel; 1 for a
//! failure, a conflict, or a partial failure; 2 for a bad command line, or no
//! terminal without `--yes`. Reasons for failures go to standard error.
//!
//! On a terminal it uses the cliclack prompts ([`ClackUi`]); `--yes` without a
//! terminal prints plain text. This module also holds the glue of the quiet
//! update notice.

use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;

use crate::cli::Env;
use crate::cli::args::UpdateArgs;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::integrations::apply::{ApplyOptions, apply_all, exit_code};
use crate::integrations::assets::bundle;
use crate::integrations::notice::stale_line;
use crate::integrations::paths::{PathEnv, registry_path};
use crate::integrations::plan::{AgentPlan, PlanState};
use crate::integrations::recovery::recover_pending;
use crate::integrations::registry::Registry;
use crate::integrations::report;
use crate::integrations::ui::{ClackUi, End, PlainUi, Tone, Ui};
use crate::integrations::update::{AgentRecords, UpdateInput, plan_update, select};

const NONE_FOUND: &str = "No managed integrations found. Run agboard connect in a bound project.\n";

/// The folder update works from: the nearest bound project, if any.
pub struct Session {
    pub path_env: PathEnv,
    pub project: Option<(String, String)>,
    pub root: Option<PathBuf>,
}

/// Runs update on the real terminal.
pub fn run(env: &mut Env, args: &UpdateArgs) -> Result<i32, AgboardError> {
    let terminal = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    if !args.yes && !terminal {
        return Err(AgboardError::InvalidArgument {
            message: "update asks for a confirmation and needs a terminal; it never reads a pipe or waits for input. Run it in a terminal, or add --yes to skip the question.".to_string(),
            command: Some("update".to_string()),
        });
    }
    let cwd =
        std::env::current_dir().map_err(|_| AgboardError::FolderUnbound { folder: ".".into() })?;
    let bound = FileStore::open(&env.shared_dir).resolve_binding(&cwd)?;
    let session = Session {
        path_env: PathEnv::from_process(),
        root: bound.as_ref().map(|b| b.bound_root.clone()),
        project: bound.map(|b| (b.project.id.to_string(), b.project.name)),
    };
    if terminal {
        let mut ui = ClackUi::new("update", session.path_env.home.clone());
        return Ok(flow_with(&mut ui, &session, args.yes));
    }
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    Ok(flow(
        &mut input,
        &mut *env.stdout,
        &mut *env.stderr,
        &session,
        args.yes,
    ))
}

/// The steps in plain text, reading one line for the question. Returns the
/// exit code.
pub fn flow(
    input: &mut dyn BufRead,
    out: &mut dyn Write,
    err: &mut dyn Write,
    s: &Session,
    yes: bool,
) -> i32 {
    flow_with(&mut PlainUi::new(input, out, err), s, yes)
}

/// Everything after the terminal and the folder are known. Returns the exit
/// code.
pub fn flow_with(ui: &mut dyn Ui, s: &Session, yes: bool) -> i32 {
    let registry = match registry_path(&s.path_env).map(|path| Registry::read(&path)) {
        Ok(Ok(registry)) => registry.unwrap_or_default(),
        Ok(Err(error)) | Err(error) => {
            ui.problem(&format!("Error: {error}\nNothing was changed.\n"));
            return 1;
        }
    };
    let selected = select(&registry, s.root.as_deref());
    if selected.is_empty() {
        ui.finish(End::Done, NONE_FOUND);
        return 0;
    }
    let bundle = match bundle() {
        Ok(bundle) => bundle,
        Err(error) => {
            ui.problem(&format!("Error: {error}\n"));
            return 1;
        }
    };
    let input = UpdateInput {
        env: &s.path_env,
        bundle: &bundle,
        project_id: s.project.as_ref().map(|(id, _)| id.as_str()),
        root: s.root.as_deref(),
        registry: &registry,
    };
    ui.intro("agboard update", &header(s));
    let mut stopped = false;
    let mut recovered = false;
    let plans = plan_all(ui, &input, &selected, &mut stopped, &mut recovered);
    for plan in &plans {
        let own = selected.iter().find(|r| r.agent == plan.agent);
        let records: Vec<_> = own.map(|r| r.all().cloned().collect()).unwrap_or_default();
        ui.update_plan(plan, &records);
    }
    let ready = plans.iter().any(|plan| plan.state() == PlanState::Ready);
    if !ready {
        let blocked = plans.iter().any(|plan| plan.state() == PlanState::Blocked);
        if blocked || stopped {
            ui.update_blocked(&plans);
            ui.finish(
                End::Failed,
                "\nNothing can be updated. Nothing was written.\n",
            );
            return 1;
        }
        ui.finish(
            End::Done,
            "\nEverything is up to date. Nothing was written.\n",
        );
        return 0;
    }
    ui.update_backups();
    if !yes && !ui.confirm("Apply these updates?") {
        ui.finish(
            End::Cancelled,
            if recovered {
                "\nCancelled. The unfinished earlier run was undone; nothing else was changed.\n"
            } else {
                "\nCancelled. Nothing was changed.\n"
            },
        );
        return 0;
    }
    let outcomes = apply_all(&s.path_env, &plans, &ApplyOptions::default());
    let code = exit_code(&outcomes).max(i32::from(stopped));
    ui.update_results(&outcomes, &plans, code);
    code
}

fn header(s: &Session) -> String {
    match (&s.project, &s.root) {
        (Some((_, name)), Some(root)) => format!(
            "Project: {name}\nBound root: {}\nUpdating Global integrations and this project's.\n\n",
            root.display()
        ),
        _ => "This folder is not bound to a project. Updating Global integrations only.\n\n"
            .to_string(),
    }
}

/// Recovers an unfinished earlier run, then plans each agent. Agents that
/// cannot be planned are reported on standard error and set `stopped`.
fn plan_all(
    ui: &mut dyn Ui,
    input: &UpdateInput,
    selected: &[AgentRecords],
    stopped: &mut bool,
    recovered: &mut bool,
) -> Vec<AgentPlan> {
    let mut plans = Vec::new();
    for records in selected {
        let agent = records.agent;
        match recover_pending(input.env, agent, None) {
            Ok(None) => {}
            Ok(Some(found)) => {
                let text = report::recovery(agent, &found, "update");
                if found.is_clean() {
                    ui.say(Tone::Info, &text);
                    *recovered |= !found.restored.is_empty();
                } else {
                    ui.problem(&text);
                    *stopped = true;
                    continue;
                }
            }
            Err(error) => {
                ui.problem(&format!("{}: {error}\n", agent.label()));
                *stopped = true;
                continue;
            }
        }
        match plan_update(input, records) {
            Ok(plan) => plans.push(plan),
            Err(reason) => {
                ui.problem(&format!("{}: not updated; {reason}\n", agent.label()));
                *stopped = true;
            }
        }
    }
    plans
}

/// Prints the update notice on standard error when the command ran on a
/// terminal with human output. Never changes the command's result.
pub fn notice_if_stale(env: &mut Env, json: bool) {
    if json || !std::io::stdout().is_terminal() || !std::io::stderr().is_terminal() {
        return;
    }
    let Ok(cwd) = std::env::current_dir() else {
        return;
    };
    let line = stale_line(
        &PathEnv::from_process(),
        &env.shared_dir,
        &cwd,
        env!("CARGO_PKG_VERSION"),
    );
    if let Some(line) = line {
        let _ = writeln!(env.stderr, "{line}");
        let _ = env.stderr.flush();
    }
}
