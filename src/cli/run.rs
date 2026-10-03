//! Parse, prepare the context, run the command, print, then call `after_commit`.

use std::ffi::OsString;
use std::io::Write;

use crate::cli::args::{self, Cli, Command, Parsed};
use crate::cli::{Context, Env, Outcome, commands, errors, output};
use crate::clock::SystemClock;
use crate::error::SkanError;
use crate::store::Store;

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
    match prepare_and_run(&cli, env) {
        Ok((ctx, outcome)) => {
            let text = if cli.json {
                format!("{}\n", output::render_json(&outcome.json))
            } else {
                outcome.human
            };
            write_text(env.stdout, &text);
            if outcome.changed {
                (env.after_commit)(&ctx);
            }
            0
        }
        Err(error) => fail(env, &error, cli.json),
    }
}

fn prepare_and_run(cli: &Cli, env: &mut Env) -> Result<(Context, Outcome), SkanError> {
    let store = Store::open(&env.db_path)?;
    // `init` and `import` create the board, so they look for it themselves.
    if !matches!(cli.command, Command::Init(_) | Command::Import(_)) && store.board()?.is_none() {
        return Err(SkanError::NotInitialized);
    }
    let mut ctx = Context {
        store,
        // The clock moves into the context; a second run with the same Env
        // would use the system clock.
        clock: std::mem::replace(&mut env.clock, Box::new(SystemClock)),
        json: cli.json,
        interactive: false,
    };
    let outcome = dispatch(&mut ctx, &cli.command)?;
    Ok((ctx, outcome))
}

fn dispatch(ctx: &mut Context, command: &Command) -> Result<Outcome, SkanError> {
    match command {
        Command::Init(args) => commands::init::run(ctx, args),
        Command::Add(args) => commands::add::run(ctx, args),
        Command::Edit(args) => commands::edit::run(ctx, args),
        Command::Mv(args) => commands::mv::run(ctx, args),
        Command::State(args) => commands::state::run(ctx, args),
        Command::Rm(args) => commands::rm::run(ctx, args),
        Command::Ls(args) => commands::ls::run(ctx, args),
        Command::Show(args) => commands::show::run(ctx, args),
        Command::Export(args) => commands::export::run(ctx, args),
        Command::Import(args) => commands::import::run(ctx, args),
        Command::Serve(args) => commands::serve::run(ctx, args),
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

/// Print and flush; a closed pipe (`skan ls | head`) is not an error.
fn write_text(out: &mut dyn Write, text: &str) {
    let _ = out.write_all(text.as_bytes());
    if !text.ends_with('\n') {
        let _ = out.write_all(b"\n");
    }
    let _ = out.flush();
}

/// Called once after a command that changed the board. Does nothing yet; the
/// serve notification is added later.
pub fn after_commit(_ctx: &Context) {}
