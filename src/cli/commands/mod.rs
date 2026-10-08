//! One module per subcommand. Each exposes
//! `pub fn run(ctx: &mut Context, args: &XxxArgs) -> Result<Outcome, SkanError>`.

pub mod add;
pub mod attachment;
pub mod edit;
pub mod export;
pub mod import;
pub mod init;
pub mod ls;
pub mod mv;
pub mod project;
pub mod rm;
pub mod serve;
pub mod show;
pub mod snapshot;
pub mod state;
