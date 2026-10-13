//! Parse, prepare the context, run the command, print, then call `after_commit`.

use std::ffi::OsString;
use std::io::Write;

use crate::cli::args::{self, Cli, Command, EpicCommand, EvidenceCommand, Parsed, ProjectCommand};
use crate::cli::{Context, Env, Outcome, Target, commands, errors, output};
use crate::clock::SystemClock;
use crate::domain::validate_project_name;
use crate::error::AgboardError;
use crate::file_store::FileStore;

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
            crate::agent::hook::run(agent, &mut stdin, &env.shared_dir, cli.project())
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
            .map_err(|error| AgboardError::BoardUnavailable {
                reason: error.to_string(),
            })
            .and_then(|runtime| {
                runtime.block_on(crate::agent::wait::wait_for_change(
                    &env.shared_dir,
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
                    .shared_dir
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

/// How a command uses the projects, which decides how its target is resolved.
enum Access {
    /// Reads one project; the project must exist.
    ReadProject,
    /// Reads the catalog; without a shared folder the list is empty.
    ReadCatalog,
    /// Changes one project that must already exist.
    ChangeProject,
    /// `init`: change the project, or create it if it is missing.
    ChangeOrCreateProject,
    /// Changes the catalog or runs without a project (`project create`).
    Catalog,
}

fn access(command: &Command) -> Access {
    match command {
        // The list of every project reads the catalog and names no project.
        Command::Ls(args) if args.all_projects => Access::ReadCatalog,
        Command::Ls(_) | Command::Show(_) | Command::Snapshot(_) | Command::Workspace(_) => {
            Access::ReadProject
        }
        Command::Epic(args) => match args.command {
            EpicCommand::Ls | EpicCommand::Show(_) => Access::ReadProject,
            EpicCommand::Add(_) | EpicCommand::Edit(_) | EpicCommand::Rm(_) => {
                Access::ChangeProject
            }
        },
        Command::Evidence(args) => match args.command {
            EvidenceCommand::Show(_) => Access::ReadProject,
            EvidenceCommand::Add(_) | EvidenceCommand::Rm(_) => Access::ChangeProject,
        },
        Command::Project(args) => match args.command {
            ProjectCommand::Ls => Access::ReadCatalog,
            ProjectCommand::Create(_) | ProjectCommand::Bind(_) => Access::Catalog,
            ProjectCommand::Rename(_) | ProjectCommand::Rm => Access::ChangeProject,
        },
        Command::Init(_) => Access::ChangeOrCreateProject,
        Command::Add(_)
        | Command::Attachment(_)
        | Command::Edit(_)
        | Command::Mv(_)
        | Command::State(_)
        | Command::Rm(_) => Access::ChangeProject,
        Command::Serve(_) | Command::Hook(_) | Command::Wait(_) => Access::Catalog,
    }
}

fn prepare_and_run(cli: &Cli, env: &mut Env) -> Result<(Option<Context>, Outcome), AgboardError> {
    // The name is normalized once. `--project` is absent only for commands
    // that work on the catalog; nothing is chosen for a command that lacks it.
    let name = match cli.project() {
        Some(raw) => Some(validate_project_name(raw)?),
        None => None,
    };
    let access = access(&cli.command);
    let files = FileStore::open(&env.shared_dir);
    let target = match name {
        Some(name) => match files.project_by_name(&name) {
            Ok(meta) => Target::Existing(meta),
            // `init` creates a project that does not exist yet.
            Err(AgboardError::ProjectNotFound { .. })
                if matches!(access, Access::ChangeOrCreateProject) =>
            {
                Target::Missing { name }
            }
            Err(error) => return Err(error),
        },
        None => Target::Catalog,
    };
    let mut ctx = Context {
        files,
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

fn dispatch(ctx: &mut Context, command: &Command) -> Result<Outcome, AgboardError> {
    match command {
        Command::Project(args) => commands::project::run(ctx, args),
        Command::Init(args) => commands::init::run(ctx, args),
        Command::Add(args) => commands::add::run(ctx, args),
        Command::Attachment(args) => commands::attachment::run(ctx, args),
        Command::Epic(args) => commands::epic::run(ctx, args),
        Command::Evidence(args) => commands::evidence::run(ctx, args),
        Command::Edit(args) => commands::edit::run(ctx, args),
        Command::Mv(args) => commands::mv::run(ctx, args),
        Command::State(args) => commands::state::run(ctx, args),
        Command::Rm(args) => commands::rm::run(ctx, args),
        Command::Ls(args) => commands::ls::run(ctx, args),
        Command::Show(args) => commands::show::run(ctx, args),
        Command::Snapshot(_) => commands::snapshot::run(ctx),
        Command::Workspace(_) => commands::workspace::run(ctx),
        Command::Hook(_) | Command::Wait(_) | Command::Serve(_) => {
            unreachable!("serve and the agent commands are handled before store setup")
        }
    }
}

fn fail(env: &mut Env, error: &AgboardError, json: bool) -> i32 {
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
/// `agboard serve` so open browsers refresh. Best effort, and the change is
/// already saved whatever happens here. When the server that `serve.json` names
/// does not answer, the open board will not refresh, so a warning on stderr says
/// why and what to do.
pub fn after_commit(_ctx: &Context, dir: &std::path::Path) {
    if crate::interact::notify::notify_serve_in(dir) {
        return;
    }
    if let Some(info) = crate::paths::read_serve_info_in(dir)
        && !crate::server::is_serving(&info)
    {
        eprintln!(
            "Saved. The open board is not updated: serve.json names the server on port {}, which is not running. Run \"agboard serve\" again.",
            info.port
        );
    }
}
