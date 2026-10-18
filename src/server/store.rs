//! Access to the shared files for the routers: blocking file work, the index,
//! and the IDs in a URL.

use std::sync::Arc;

use axum::http::HeaderMap;

use super::AppState;
use super::guard::header_text;
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::index::ProjectEntry;

/// Run `work` on the shared files on a blocking thread.
pub(crate) async fn with_files<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(FileStore) -> Result<T, AgboardError> + Send + 'static,
) -> Result<T, AgboardError> {
    let shared = state.shared.clone();
    tokio::task::spawn_blocking(move || work(FileStore::open(&shared)))
        .await
        .map_err(|e| AgboardError::DatabaseError {
            reason: format!("The file task failed: {e}"),
        })?
}

/// Carry a browser's selected language explicitly into one blocking file operation.
pub(crate) async fn with_request_files<T: Send + 'static>(
    state: &AppState,
    headers: &HeaderMap,
    work: impl FnOnce(FileStore) -> Result<T, AgboardError> + Send + 'static,
) -> Result<T, AgboardError> {
    let language = header_text(headers, "x-agboard-language")
        .and_then(crate::file_store::history_language::HistoryLanguage::from_setting);
    with_files(state, move |store| {
        work(store.with_history_language(language))
    })
    .await
}

/// After a save made by this server, read the shared files again before the
/// answer goes out, so the next read agrees with it. A `changed` is sent only
/// if the catalog version moved, as for every other reload.
pub(crate) fn refresh_index(state: &AppState) {
    let mut index = state.index.write().unwrap_or_else(|e| e.into_inner());
    if index.reload_all(&state.shared).unwrap_or(false) {
        let _ = state.changed.send(());
    }
}

/// The project named in the URL. The URL is a name for a project, never a
/// credential: an ID that is not well formed is `invalid_value`.
pub(crate) fn parse_project_id(raw: &str) -> Result<ProjectId, AgboardError> {
    raw.parse()
}

/// The project's index entry as its last good read, or the error of a defective
/// project. A project that is not in the index is `project_not_found`.
pub(crate) fn indexed_view(
    state: &AppState,
    id: &ProjectId,
) -> Result<Arc<crate::file_store::reader::ProjectSnapshot>, AgboardError> {
    indexed_view_in(&state.shared, &state.index, id)
}

pub(crate) fn indexed_view_in(
    shared: &std::path::Path,
    index: &std::sync::RwLock<crate::file_store::index::ProjectIndex>,
    id: &ProjectId,
) -> Result<Arc<crate::file_store::reader::ProjectSnapshot>, AgboardError> {
    // A folder that is gone is a deleted project, even before the watcher reloads.
    if !crate::file_store::layout::project_dir(shared, id).is_dir() {
        return Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        });
    }
    let index = index.read().unwrap_or_else(|e| e.into_inner());
    match index.entry(id) {
        None => Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        }),
        Some(ProjectEntry::Ready { view, .. }) => Ok(view.clone()),
        Some(ProjectEntry::Invalid { error, .. }) => Err(match error {
            AgboardError::FileInvalid {
                file,
                field,
                reason,
            } => AgboardError::FileInvalid {
                file: file.clone(),
                field: field.clone(),
                reason: reason.clone(),
            },
            other => AgboardError::FileError {
                action: crate::error::FileAction::Read,
                file: id.to_string(),
                reason: other.reason(),
            },
        }),
    }
}

/// The bytes of a file the store has already checked the path of.
pub(crate) fn read_checked(
    store: &FileStore,
    path: &std::path::Path,
) -> Result<Vec<u8>, AgboardError> {
    let label = crate::file_store::layout::shared_label(store.shared_dir(), path);
    crate::file_store::io::read_bytes(path, &label)
}
