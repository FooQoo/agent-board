use crate::cli::args::AddArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &AddArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "add".to_string(),
    })
}
