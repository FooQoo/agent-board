//! One module per subcommand. Each exposes
//! `pub fn run(ctx: &mut Context, args: &XxxArgs) -> Result<Outcome, AgboardError>`.

pub mod add;
pub mod attachment;
pub mod edit;
pub mod epic;
pub mod init;
pub mod ls;
pub mod message;
pub mod mv;
pub mod open;
pub mod progress;
pub mod project;
pub mod remote;
pub mod rm;
pub mod serve;
pub mod serve_auto;
pub mod setup;
pub mod show;
pub mod snapshot;
pub mod start;
pub mod state;
pub mod stop;
pub mod workspace;

pub mod history;
