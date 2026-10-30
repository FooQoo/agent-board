//! Reading shared files.
//!
//! Two styles of read exist. The strict reads (`read_*`) fail on the first
//! defect of the file they need, and writes depend on them. The snapshot read
//! keeps going: a broken task is left out and reported in `problems`, and a
//! TASK.md with a format defect is returned as it is, with the defect reported.
//! `project.json` is the one file whose defect fails the whole snapshot.

mod epics;
mod files;
mod project;
mod snapshot;
mod task;

pub(in crate::file_store) use self::epics::*;
pub(crate) use self::files::*;
pub use self::project::*;
pub use self::snapshot::*;
pub use self::task::*;
