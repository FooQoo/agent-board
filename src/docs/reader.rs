//! Reading the Docs: the tree, a file and an image. Not built yet; the routes
//! call these, so the bodies can be filled in without touching the routes.

use super::model::{DocsError, DocsFile, DocsRoot, DocsTree};
use super::paths::DocsPath;

pub fn not_implemented() -> DocsError {
    DocsError::DocsNotImplemented
}

pub fn read_tree(_root: &DocsRoot) -> Result<DocsTree, DocsError> {
    Err(not_implemented())
}

pub fn read_file(_root: &DocsRoot, _path: &DocsPath) -> Result<DocsFile, DocsError> {
    Err(not_implemented())
}

/// The image's bytes and its fixed `Content-Type`.
pub fn read_asset(
    _root: &DocsRoot,
    _path: &DocsPath,
) -> Result<(Vec<u8>, &'static str), DocsError> {
    Err(not_implemented())
}
