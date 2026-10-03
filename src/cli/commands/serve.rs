use crate::cli::args::ServeArgs;
use crate::cli::{Context, Outcome};
use crate::error::SkanError;

pub fn run(_ctx: &mut Context, _args: &ServeArgs) -> Result<Outcome, SkanError> {
    Err(SkanError::NotImplemented {
        command: "serve".to_string(),
    })
}
