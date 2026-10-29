//! Parse, prepare the context, run the command, print, then call `after_commit`.

mod prepare;

use std::ffi::OsString;
use std::io::Write;

use self::prepare::prepare_and_run;
use crate::cli::args::{self, Command, Parsed, SetupAgentArg};
use crate::cli::{Context, Env, commands, errors, output};
use crate::error::AgboardError;
use crate::setup::{self, Agent, SetupEnv, SetupOptions};

/// Runs a command line when no data directory can be resolved (no
/// `AGBOARD_HOME` and no home directory). Help and version still print; every
/// other command fails with `error`, because nothing can be stored without a
/// data directory and the working directory is never used instead.
pub fn execute_without_data_dir(
    args: &[OsString],
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
    error: &AgboardError,
) -> i32 {
    let json_requested = args.iter().any(|arg| arg == "--json");
    match args::parse(args) {
        Ok(Parsed::Print(text)) => {
            write_text(stdout, &text);
            0
        }
        Ok(Parsed::Run(_)) => {
            let text = if json_requested {
                errors::json(error)
            } else {
                errors::human(error)
            };
            write_text(stderr, &text);
            error.exit_code()
        }
        Err(parse_error) => {
            let text = if json_requested {
                errors::json(&parse_error)
            } else {
                errors::human(&parse_error)
            };
            write_text(stderr, &text);
            parse_error.exit_code()
        }
    }
}

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
    // `setup` needs no project and no store: it resolves the data directory
    // itself and runs before any board files are opened.
    if let Command::Setup(args) = &cli.command {
        let agents = match args.agent {
            SetupAgentArg::Codex => vec![Agent::Codex],
            SetupAgentArg::Claude => vec![Agent::Claude],
            SetupAgentArg::All => vec![Agent::Codex, Agent::Claude],
        };
        let options = SetupOptions {
            agents,
            dry_run: args.dry_run,
        };
        return match setup::run(&SetupEnv::from_process(), &options) {
            Ok(report) => {
                let text = if cli.json {
                    format!("{}\n", output::render_json(&report.to_json()))
                } else {
                    report.to_human()
                };
                write_text(env.stdout, &text);
                0
            }
            Err(error) => fail(env, &error, cli.json),
        };
    }
    // `connect` is interactive: it checks the terminal and the folder binding
    // itself and prints its own results.
    if let Command::Connect(_) = &cli.command {
        return match commands::connect::run(env) {
            Ok(code) => code,
            Err(error) => fail(env, &error, false),
        };
    }
    if let Command::Update(args) = &cli.command {
        return match commands::update::run(env, args) {
            Ok(code) => code,
            Err(error) => fail(env, &error, false),
        };
    }
    if let Command::Hook(args) = &cli.command {
        let agent = match args.agent {
            args::AgentArg::Claude => "claude",
            args::AgentArg::Codex => "codex",
        };
        let mut stdin = std::io::stdin().lock();
        if let Some(output) = crate::agent::hook::run_with(
            agent,
            &mut stdin,
            &env.shared_dir,
            cli.project(),
            crate::progress::Include {
                pending: args.progress.include_pending,
                done: args.progress.include_done,
            },
        ) {
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
            .and_then(|runtime| match args.until {
                Some(args::WaitUntilArg::Task) => {
                    runtime.block_on(crate::agent::task_wait::wait_for_task(
                        &env.shared_dir,
                        cli.project().unwrap_or_default(),
                        args.idle_timeout
                            .expect("wait task mode requires --idle-timeout"),
                    ))
                }
                None => runtime.block_on(crate::agent::wait::wait_for_change(
                    &env.shared_dir,
                    cli.project().unwrap_or_default(),
                    args.after
                        .clone()
                        .unwrap_or_else(|| unreachable!("wait args validated")),
                    args.timeout,
                )),
            });
        return match result {
            Ok(output) => {
                write_text(env.stdout, &output);
                0
            }
            Err(error) => fail(env, &error, cli.json),
        };
    }
    // `serve` needs no project and no task context: it opens the data area
    // itself, writes its startup line while it runs, and prints nothing after.
    if let Command::Serve(args) = &cli.command {
        return match commands::serve::run(cli.json, args) {
            Ok(()) => 0,
            Err(error) => fail(env, &error, cli.json),
        };
    }
    if let Command::Stop(_) = &cli.command {
        return match commands::stop::run(cli.json) {
            Ok(text) => {
                write_text(env.stdout, &text);
                0
            }
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
            commands::update::notice_if_stale(env, cli.json);
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
