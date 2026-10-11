//! The independently built, read-only monitor web assets.

pub mod assets;
mod router;

pub(crate) use router::{MonitorState, router};
