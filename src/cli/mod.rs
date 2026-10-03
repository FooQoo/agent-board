//! The `skan` command line interface.

pub mod args;
pub mod commands;
pub mod errors;
pub mod output;
pub mod run;

use std::ffi::OsString;
use std::io::Write;
use std::path::PathBuf;

use crate::clock::{Clock, SystemClock};
use crate::store::Store;

/// Everything a command runs with.
pub struct Context {
    /// `init` and `import` check for a board themselves.
    pub store: Store,
    pub clock: Box<dyn Clock>,
    pub json: bool,
    /// Whether a human can be asked to confirm. Always `false` for now.
    pub interactive: bool,
}

/// What a command did.
pub struct Outcome {
    pub changed: bool,
    /// Text for a human; ends with a newline.
    pub human: String,
    pub json: serde_json::Value,
}

/// The outside world of one run: where the board is, the time, and where the
/// output goes. Tests supply their own.
pub struct Env<'a> {
    pub clock: Box<dyn Clock>,
    pub db_path: PathBuf,
    pub stdout: &'a mut dyn Write,
    pub stderr: &'a mut dyn Write,
    /// Called once after a command that changed the board.
    pub after_commit: &'a mut dyn FnMut(&Context),
}

/// Entry point of the command line interface. Returns the process exit code.
pub fn run() -> i32 {
    let args: Vec<OsString> = std::env::args_os().collect();
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    let mut after_commit = |ctx: &Context| run::after_commit(ctx);
    let mut env = Env {
        clock: Box::new(SystemClock),
        db_path: crate::paths::db_path(),
        stdout: &mut stdout,
        stderr: &mut stderr,
        after_commit: &mut after_commit,
    };
    run_with(&args, &mut env)
}

/// Like [`run`], but with the arguments and environment given.
pub fn run_with(args: &[OsString], env: &mut Env) -> i32 {
    run::execute(args, env)
}
