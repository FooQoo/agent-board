use crate::cli::args::LsArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &LsArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "ls".to_string(),
    })
}
