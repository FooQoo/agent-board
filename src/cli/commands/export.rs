use crate::cli::args::ExportArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &ExportArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "export".to_string(),
    })
}
