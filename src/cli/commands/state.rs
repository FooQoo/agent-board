use crate::cli::args::StateArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &StateArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "state".to_string(),
    })
}
