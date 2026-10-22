//! Saving a Docs file: a compare-and-swap on the file's revision.
//!
//! Saves of one Docs folder run one at a time under a mutex held in this
//! process. Inside it the current file is read, its revision compared with the
//! one the caller read, and only a match is replaced, through a temporary file
//! and a rename. The content is written as the exact bytes it arrived as.
//!
//! Limit: another process (an editor, `git`) does not take this mutex, so a
//! write it makes between the comparison and the rename is overwritten
//! without notice.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};

use super::MAX_FILE_BYTES;
use super::model::{DocsError, DocsRoot};
use super::paths::DocsPath;
use super::revision::revision_of;
use crate::file_store::io::{read_error, write_atomic};

/// One mutex per Docs folder, created on first use and kept for the process.
fn lock_for(root: &DocsRoot) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<std::path::PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.entry(root.dir().to_path_buf()).or_default().clone()
}

/// Write `content` if the file is still at `expected_revision`; returns the new revision.
///
/// A file that does not exist is `docs_not_found`: saving never creates one.
/// A different current revision is `docs_revision_conflict`, and the file is
/// left as it was, as it is when the write itself fails.
pub fn save_file(
    root: &DocsRoot,
    path: &DocsPath,
    content: &str,
    expected_revision: &str,
) -> Result<String, DocsError> {
    let label = path.as_string();
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(DocsError::DocsTooLarge {
            path: label,
            limit: MAX_FILE_BYTES,
        });
    }
    let lock = lock_for(root);
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut file = root.open_file(path)?;
    let mut current = Vec::new();
    (&mut file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut current)
        .map_err(|error| read_error(&label, error))?;
    if current.len() as u64 > MAX_FILE_BYTES {
        return Err(DocsError::DocsTooLarge {
            path: label,
            limit: MAX_FILE_BYTES,
        });
    }
    let current_revision = revision_of(&current);
    if current_revision != expected_revision {
        return Err(DocsError::DocsRevisionConflict {
            expected: expected_revision.to_string(),
            current: current_revision,
        });
    }
    let readonly = file
        .metadata()
        .map_err(|error| read_error(&label, error))?
        .permissions()
        .readonly();
    drop(file);
    if readonly {
        return Err(DocsError::DocsReadOnly { path: label });
    }

    let mut target = root.dir().to_path_buf();
    target.extend(path.elements());
    write_atomic(&target, content.as_bytes(), &label)?;
    Ok(revision_of(content.as_bytes()))
}
