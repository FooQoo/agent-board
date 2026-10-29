//! Resolving the target project for a command and dispatching it to its
//! handler, for the commands that work on a board.

use crate::cli::args::{Cli, Command, EpicCommand, ProjectCommand};
use crate::cli::{Context, Env, Outcome, Target, commands};
use crate::clock::SystemClock;
use crate::domain::validate_project_name;
use crate::error::AgboardError;
use crate::file_store::FileStore;

/// How a command uses the projects, which decides how its target is resolved.
enum Access {
    /// Reads one project; the project must exist.
    ReadProject,
    /// Reads the project bound to the current folder when no name is given.
    ReadBoundProject,
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
        | Command::History(_)
        | Command::Rm(_) => Access::ChangeProject,
        Command::Progress(_) => Access::ReadBoundProject,
        Command::Serve(_)
        | Command::Stop(_)
        | Command::Setup(_)
        | Command::Connect(_)
        | Command::Update(_)
        | Command::Hook(_)
        | Command::Wait(_) => Access::Catalog,
    }
}

pub(super) fn prepare_and_run(
    cli: &Cli,
    env: &mut Env,
) -> Result<(Option<Context>, Outcome), AgboardError> {
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
        None if matches!(access, Access::ReadBoundProject) => {
            let cwd = std::env::current_dir()
                .map_err(|_| AgboardError::FolderUnbound { folder: ".".into() })?;
            Target::Existing(files.project_for_folder(&cwd)?)
        }
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
        Command::Edit(args) => commands::edit::run(ctx, args),
        Command::Mv(args) => commands::mv::run(ctx, args),
        Command::State(args) => commands::state::run(ctx, args),
        Command::History(args) => commands::history::run(ctx, args),
        Command::Rm(args) => commands::rm::run(ctx, args),
        Command::Ls(args) => commands::ls::run(ctx, args),
        Command::Show(args) => commands::show::run(ctx, args),
        Command::Snapshot(_) => commands::snapshot::run(ctx),
        Command::Workspace(_) => commands::workspace::run(ctx),
        Command::Progress(args) => commands::progress::run(ctx, args),
        Command::Hook(_)
        | Command::Wait(_)
        | Command::Serve(_)
        | Command::Stop(_)
        | Command::Setup(_)
        | Command::Connect(_)
        | Command::Update(_) => {
            unreachable!("serve, setup, and the agent commands are handled before store setup")
        }
    }
}
