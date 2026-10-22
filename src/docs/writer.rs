//! Saving a Docs file. Not built yet; the route calls this, so the body can be
//! filled in without touching the route.

use super::model::{DocsError, DocsRoot};
use super::paths::DocsPath;

pub fn not_implemented() -> DocsError {
    DocsError::DocsNotImplemented
}

/// Write `content` if the file is still at `expected_revision`; returns the new revision.
pub fn save_file(
    _root: &DocsRoot,
    _path: &DocsPath,
    _content: &str,
    _expected_revision: &str,
) -> Result<String, DocsError> {
    Err(not_implemented())
}
