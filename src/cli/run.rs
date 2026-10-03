//! Parse, prepare the context, run the command, print, then call `after_commit`.

use std::ffi::OsString;

use crate::cli::{Context, Env};

/// Runs `args` and returns the process exit code.
pub fn execute(_args: &[OsString], _env: &mut Env) -> i32 {
    0
}

/// Called once after a command that changed the board. Does nothing yet; the
/// serve notification is added later.
pub fn after_commit(_ctx: &Context) {}
