//! Parse, prepare the context, run the command, print, then call `after_commit`.

use std::ffi::OsString;
use std::io::Write;

use crate::cli::args::{self, Cli, Command, Parsed, ProjectCommand};
use crate::cli::{Context, Env, Outcome, Target, commands, errors, output};
use crate::clock::SystemClock;
use crate::domain::validate_project_name;
use crate::error::SkanError;
use crate::store::ProjectStore;

/// Runs `args` (the first item is the program name) and returns the process
/// exit code.
pub fn execute(args: &[OsString], env: &mut Env) -> i32 {
    // After a parse failure there is no parsed `--json`, so look at the raw words.
    let json_requested = args.iter().any(|arg| arg == "--json");
    let cli = match args::parse(args) {
        Ok(Parsed::Print(text)) => {
            write_text(env.stdout, &text);
            return 0;
        }
        Ok(Parsed::Run(cli)) => cli,
        Err(error) => return fail(env, &error, json_requested),
    };
    if let Err(error) = cli.validate() {
        return fail(env, &error, cli.json);
    }
    if let Command::Hook(args) = &cli.command {
        let agent = match args.agent {
            args::AgentArg::Claude => "claude",
            args::AgentArg::Codex => "codex",
        };
        let mut stdin = std::io::stdin().lock();
        if let Some(output) =
            crate::agent::hook::run(agent, &mut stdin, &env.db_path, cli.project())
        {
            write_text(env.stdout, &output);
        }
        return 0;
    }
    if let Command::Wait(args) = &cli.command {
        // The name is resolved against the same board file the other
        // commands use, and `validate` has already required it.
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| SkanError::BoardUnavailable {
                reason: error.to_string(),
            })
            .and_then(|runtime| {
                runtime.block_on(crate::agent::wait::wait_for_change(
                    &env.db_path,
                    cli.project().unwrap_or_default(),
                    args.after.clone(),
                    args.timeout,
                ))
            });
        return match result {
            Ok(output) => {
                write_text(env.stdout, &output);
                0
            }
            Err(error) => fail(env, &error, cli.json),
        };
    }
    // `serve` needs no project and no card context: it opens the data area
    // itself, writes its startup line while it runs, and prints nothing after.
    if let Command::Serve(args) = &cli.command {
        return match commands::serve::run(cli.json, args) {
            Ok(()) => 0,
            Err(error) => fail(env, &error, cli.json),
        };
    }
    match prepare_and_run(&cli, env) {
        Ok((ctx, outcome)) => {
            let text = if cli.json {
                format!("{}\n", output::render_json(&outcome.json))
            } else {
                outcome.human
            };
            write_text(env.stdout, &text);
            if let (true, Some(ctx)) = (outcome.changed, &ctx) {
                let dir = env
                    .db_path
                    .parent()
                    .filter(|dir| !dir.as_os_str().is_empty())
                    .unwrap_or_else(|| std::path::Path::new("."))
                    .to_path_buf();
                let dir = dir.as_path();
                (env.after_commit)(ctx, dir);
            }
            0
        }
        Err(error) => fail(env, &error, cli.json),
    }
}

/// How a command uses the data area, which decides how it is opened.
enum Access {
    /// Reads one project; never creates the data area.
    ReadProject,
    /// Reads the catalog; without a data area the list is empty.
    ReadCatalog,
    /// Changes one project that must already exist.
    ChangeProject,
    /// `init` and `import`: change the project, or create it if it is missing.
    ChangeOrCreateProject,
    /// Changes the catalog or runs without a project (`project create`).
    Catalog,
}

fn access(command: &Command) -> Access {
    match command {
        // The list of every project reads the catalog and names no project.
        Command::Ls(args) if args.all_projects => Access::ReadCatalog,
        Command::Ls(_) | Command::Show(_) | Command::Snapshot(_) | Command::Export(_) => {
            Access::ReadProject
        }
        Command::Project(args) => match args.command {
            ProjectCommand::Ls => Access::ReadCatalog,
            ProjectCommand::Create(_) => Access::Catalog,
            ProjectCommand::Rename(_) | ProjectCommand::Rm => Access::ChangeProject,
        },
        Command::Init(_) | Command::Import(_) => Access::ChangeOrCreateProject,
        Command::Add(_)
        | Command::Attachment(_)
        | Command::Edit(_)
        | Command::Mv(_)
        | Command::State(_)
        | Command::Rm(_) => Access::ChangeProject,
        Command::Serve(_) | Command::Hook(_) | Command::Wait(_) => Access::Catalog,
    }
}

fn prepare_and_run(cli: &Cli, env: &mut Env) -> Result<(Option<Context>, Outcome), SkanError> {
    // The name is normalized once. `--project` is absent only for commands
    // that work on the catalog; nothing is chosen for a command that lacks it.
    let name = match cli.project() {
        Some(raw) => Some(validate_project_name(raw)?),
        None => None,
    };
    let access = access(&cli.command);
    let not_found = |name: &Option<String>| SkanError::ProjectNotFound {
        project: name.clone().unwrap_or_default(),
    };
    let store = match access {
        Access::ReadProject | Access::ReadCatalog => {
            // A read never creates the data area.
            match ProjectStore::open_read_only(&env.db_path) {
                Ok(store) => store,
                Err(SkanError::NotInitialized) if matches!(access, Access::ReadCatalog) => {
                    return Ok((None, empty_outcome(cli, env)));
                }
                Err(SkanError::NotInitialized) => return Err(not_found(&name)),
                Err(error) => return Err(error),
            }
        }
        // A project that cannot exist yet is not found; do not create the
        // data area only to say so.
        Access::ChangeProject if !env.db_path.exists() => return Err(not_found(&name)),
        Access::ChangeProject | Access::ChangeOrCreateProject | Access::Catalog => {
            ProjectStore::open(&env.db_path)?
        }
    };
    let target = match name {
        Some(name) => match store.project_by_name(&name) {
            Ok(meta) => Target::Existing(meta),
            // `init` and `import` create a project that does not exist yet.
            Err(SkanError::ProjectNotFound { .. })
                if matches!(access, Access::ChangeOrCreateProject) =>
            {
                Target::Missing { name }
            }
            Err(error) => return Err(error),
        },
        None => Target::Catalog,
    };
    let mut ctx = Context {
        store,
        target,
        // The clock moves into the context; a second run with the same Env
        // would use the system clock.
        clock: std::mem::replace(&mut env.clock, Box::new(SystemClock)),
        json: cli.json,
        interactive: false,
    };
    let outcome = dispatch(&mut ctx, &cli.command)?;
    Ok((Some(ctx), outcome))
}

/// What a catalog read returns when no data area exists yet: the same shape as
/// an existing area without projects.
fn empty_outcome(cli: &Cli, env: &Env) -> Outcome {
    match &cli.command {
        Command::Ls(_) => commands::ls::empty_all_projects(env.clock.as_ref()),
        _ => commands::project::empty_list(),
    }
}

fn dispatch(ctx: &mut Context, command: &Command) -> Result<Outcome, SkanError> {
    match command {
        Command::Project(args) => commands::project::run(ctx, args),
        Command::Init(args) => commands::init::run(ctx, args),
        Command::Add(args) => commands::add::run(ctx, args),
        Command::Attachment(args) => commands::attachment::run(ctx, args),
        Command::Edit(args) => commands::edit::run(ctx, args),
        Command::Mv(args) => commands::mv::run(ctx, args),
        Command::State(args) => commands::state::run(ctx, args),
        Command::Rm(args) => commands::rm::run(ctx, args),
        Command::Ls(args) => commands::ls::run(ctx, args),
        Command::Show(args) => commands::show::run(ctx, args),
        Command::Snapshot(_) => commands::snapshot::run(ctx),
        Command::Hook(_) | Command::Wait(_) | Command::Serve(_) => {
            unreachable!("serve and the agent commands are handled before store setup")
        }
        Command::Export(args) => commands::export::run(ctx, args),
        Command::Import(args) => commands::import::run(ctx, args),
    }
}

fn fail(env: &mut Env, error: &SkanError, json: bool) -> i32 {
    let text = if json {
        errors::json(error)
    } else {
        errors::human(error)
    };
    write_text(env.stderr, &text);
    error.exit_code()
}

/// Print and flush; a closed pipe (`agboard ls | head`) is not an error.
fn write_text(out: &mut dyn Write, text: &str) {
    let _ = out.write_all(text.as_bytes());
    if !text.ends_with('\n') {
        let _ = out.write_all(b"\n");
    }
    let _ = out.flush();
}

/// Called once after a command that changed the board: tells a running
/// `agboard serve` so open browsers refresh. Best effort; the result is ignored
/// and the notification never takes longer than its own 300 ms budget.
pub fn after_commit(_ctx: &Context, dir: &std::path::Path) {
    let _ = crate::interact::notify::notify_serve_in(dir);
}
