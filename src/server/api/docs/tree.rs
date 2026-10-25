//! `GET /api/projects/{project_id}/docs/tree`.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;

use super::failure;
use crate::docs::{DocsError, DocsRoot, reader};
use crate::server::AppState;
use crate::server::response::json_response;
use crate::server::store::parse_project_id;

pub(crate) async fn get_docs_tree(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let root = match project_root(&state, &raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    match blocking(move || reader::read_tree(&root)).await {
        Ok(tree) => json_response(StatusCode::OK, &tree),
        Err(error) => *failure(error),
    }
}

/// The project's Docs folder under the server's shared folder, from the URL's
/// project ID. The read routes use this, not the process environment.
pub(super) fn project_root(state: &AppState, raw_project: &str) -> Result<DocsRoot, Box<Response>> {
    let project = parse_project_id(raw_project).map_err(failure)?;
    Ok(DocsRoot::of_project(&state.shared, &project))
}

/// Run file work on a blocking thread.
pub(super) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, DocsError> + Send + 'static,
) -> Result<T, DocsError> {
    tokio::task::spawn_blocking(work)
        .await
        .unwrap_or_else(|error| {
            Err(DocsError::FileUnreadable {
                file: "docs".to_string(),
                reason: error.to_string(),
            })
        })
}
