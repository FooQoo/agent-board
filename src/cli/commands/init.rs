use crate::cli::args::InitArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &InitArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "init".to_string(),
    })
}
