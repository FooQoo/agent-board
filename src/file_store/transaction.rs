//! Durable replacement of one task's JSON/Markdown pair.
//!
//! Callers must hold the project's WriteLock for save and recovery, and must
//! recover before reading public state. Prepared journals roll back; committed
//! journals retain the new pair. Unexpected bytes block recovery rather than
//! overwriting a direct edit. The module never sends notifications.

mod journal;
mod paths;
mod recover;
mod save;
mod stage;

pub use self::recover::*;
pub use self::save::*;
pub use self::stage::*;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairTargets {
    pub metadata: PathBuf,
    pub markdown: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairBytes {
    pub metadata: Vec<u8>,
    pub markdown: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Recovery {
    /// Journals whose prepared/committed pair was resolved.
    pub recovered: usize,
    /// Relative task targets that recovery resolved, for cache invalidation.
    pub targets: Vec<PairTargets>,
}
