//! TASK.md acceptance frontmatter and EPIC.md task-order metadata:
//! the body that follows it, and the composition that writes both back.
//!
//! A file starts with a `---` line, YAML, and a closing `---` line. TASK.md reads
//! `acceptance`; EPIC.md interprets `waves`. Other keys are kept as they are. A file without
//! the opening line is a body with no conditions. Defects are reported with the
//! item they concern, and the product never rewrites a file to fix them.

mod acceptance;
mod questions;
mod split;
mod waves;

pub use self::acceptance::*;
pub use self::questions::*;
pub use self::split::*;
pub use self::waves::*;
