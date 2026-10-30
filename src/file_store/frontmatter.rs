//! TASK.md acceptance frontmatter and EPIC.md priority metadata:
//! the body that follows it, and the composition that writes both back.
//!
//! A file starts with a `---` line, YAML, and a closing `---` line. TASK.md reads
//! `acceptance`; EPIC.md interprets `priority`. Other keys are kept as they are. A file without
//! the opening line is a body with no conditions. Defects are reported with the
//! item they concern, and the product never rewrites a file to fix them.

mod acceptance;
mod priority;
mod split;

pub use self::acceptance::*;
pub use self::priority::*;
pub use self::split::*;
