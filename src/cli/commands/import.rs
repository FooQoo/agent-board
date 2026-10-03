use crate::cli::args::ImportArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &ImportArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "import".to_string(),
    })
}
