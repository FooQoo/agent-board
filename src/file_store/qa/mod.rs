//! Messages between people and agents, stored per project in `qa/`: the questions agents ask
//! people and the requests people send agents, one `qa/Q-<n>/QA.md` each. Also the
//! derivation of "waiting" from the questions a task refers to.

mod check;
mod codec;
mod derive;
mod model;
mod store;
mod view;

pub use self::check::*;
pub use self::codec::{parse_message, render_message};
pub use self::derive::*;
pub use self::model::*;
pub use self::store::*;
pub use self::view::*;
