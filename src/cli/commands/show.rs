use crate::cli::args::ShowArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &ShowArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "show".to_string(),
    })
}
