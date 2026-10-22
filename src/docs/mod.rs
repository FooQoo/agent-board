//! The project Docs: Markdown files kept under `<data area>/docs/<project-id>/`,
//! apart from the board's shared files. The path rules live in [`paths`], the
//! types in [`model`]; [`reader`] and [`writer`] are the calls the HTTP routes make.

pub mod model;
pub mod paths;
pub mod reader;
pub mod revision;
pub mod writer;

pub use model::{DocsError, DocsFile, DocsRoot, DocsTree, DocsTreeNode, NodeKind};
pub use paths::DocsPath;
pub use revision::revision_of;

/// The largest file the Docs read or save: 2 MiB.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// The most entries the tree lists before it says it was cut short.
pub const MAX_TREE_ENTRIES: usize = 5_000;
/// The deepest folder level the tree lists. The root's children are level 1.
pub const MAX_TREE_DEPTH: usize = 16;
/// The longest single path element, in bytes.
pub const MAX_ELEMENT_BYTES: usize = 255;
/// The longest whole path, in bytes.
pub const MAX_PATH_BYTES: usize = 1024;
