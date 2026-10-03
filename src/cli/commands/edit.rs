use crate::cli::args::EditArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &EditArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "edit".to_string(),
    })
}
