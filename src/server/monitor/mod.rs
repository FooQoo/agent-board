//! The independently built, read-only monitor web assets.

pub mod assets;
mod data;
mod router;
mod write;

pub(crate) use router::{MonitorState, apply_security_headers, router};
pub(crate) use write::router as write_router;
