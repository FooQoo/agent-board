//! The commands about remote access that need no project store: `setup remote`, and
//! `show remote` without `--project`. With a project, `show remote` goes through
//! the project like the other `show` commands.

use super::{data_dir_of, fail, write_text};
use crate::cli::args::{Cli, Command, SetupArgs, SetupCommand, ShowArgs, ShowCommand};
use crate::cli::{Env, Outcome, commands, output};
use crate::error::AgboardError;

/// Runs the command when it is one of these, and returns its exit code.
pub(super) fn run_remote_command(cli: &Cli, env: &mut Env) -> Option<i32> {
    let dir = data_dir_of(&env.shared_dir);
    let vault = crate::remote_settings::vault_from_process();
    let result: Result<Option<Outcome>, AgboardError> = match &cli.command {
        Command::Setup(SetupArgs {
            command: Some(SetupCommand::Remote(args)),
            ..
        }) => {
            let mut stdin = std::io::stdin().lock();
            commands::setup_remote::run(&dir, args, cli.json, &*vault, &mut stdin)
        }
        Command::Show(ShowArgs {
            command: Some(ShowCommand::Remote),
            ..
        }) if cli.project().is_none() => commands::remote::run(&dir, None, &*vault).map(Some),
        _ => return None,
    };
    Some(match result {
        Ok(Some(outcome)) => {
            let text = if cli.json {
                format!("{}\n", output::render_json(&outcome.json))
            } else {
                outcome.human
            };
            write_text(env.stdout, &text);
            0
        }
        // The questions were answered on the terminal, which already shows the result.
        Ok(None) => 0,
        Err(error) => fail(env, &error, cli.json),
    })
}
