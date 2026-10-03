use crate::cli::args::MvArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &MvArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "mv".to_string(),
    })
}
