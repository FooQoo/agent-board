//! `GET /api/projects/{project_id}/docs/file?path=`.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;

use super::tree::{blocking, project_root};
use super::{PathQuery, failure};
use crate::docs::{DocsPath, reader};
use crate::server::AppState;
use crate::server::response::json_response;

pub(crate) async fn get_docs_file(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    Query(query): Query<PathQuery>,
) -> Response {
    let root = match project_root(&state, &raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    let path = match DocsPath::parse_markdown(query.path()) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    match blocking(move || reader::read_file(&root, &path)).await {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => *failure(error),
    }
}
