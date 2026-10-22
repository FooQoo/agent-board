//! `PUT /api/projects/{project_id}/docs/file`. The write guard in `api` checks
//! the request first.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use super::failure;
use crate::docs::{DocsPath, DocsRoot, writer};
use crate::error::AgboardError;
use crate::server::AppState;
use crate::server::request::StrictJson;
use crate::server::response::json_response;
use crate::server::store::parse_project_id;

/// The most JSON the save reads: 2 MiB of content, every byte escaped as `\u00XX`, and the fields.
const SAVE_BODY_LIMIT: usize = 13 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveBody {
    path: String,
    content: String,
    expected_revision: String,
}

pub(crate) async fn put_docs_file(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    StrictJson(body): StrictJson<SaveBody, SAVE_BODY_LIMIT>,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return *failure(error),
    };
    // The folder comes from the server's own shared folder, not the environment.
    let root = DocsRoot::of_project(&state.shared, &project);
    let path = match DocsPath::parse_markdown(&body.path) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    // The save waits on a lock and does file work, so it runs off the async threads.
    let saved = tokio::task::spawn_blocking({
        let path = path.clone();
        move || writer::save_file(&root, &path, &body.content, &body.expected_revision)
    })
    .await;
    match saved {
        Ok(Ok(revision)) => json_response(
            StatusCode::OK,
            &serde_json::json!({"path": path.as_string(), "revision": revision}),
        ),
        Ok(Err(error @ AgboardError::DocsRevisionConflict { .. })) => conflict(&error),
        Ok(Err(error)) => *failure(error),
        Err(error) => *failure(AgboardError::DatabaseError {
            reason: format!("The save task failed: {error}"),
        }),
    }
}

/// The 409 body: the usual error, plus the revision the file has now, so the
/// page can save again over it without reading the file first.
fn conflict(error: &AgboardError) -> Response {
    let AgboardError::DocsRevisionConflict { current, .. } = error else {
        return *failure(error.clone());
    };
    json_response(
        StatusCode::CONFLICT,
        &serde_json::json!({"error": {
            "code": error.code(),
            "message": error.message(),
            "reason": error.reason(),
            "currentRevision": current,
        }}),
    )
}
