//! `GET /api/projects/{project_id}/docs/file?path=`.

use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::response::Response;

use super::{PathQuery, docs_root, failure};
use crate::docs::{DocsPath, reader};
use crate::server::response::json_response;

pub(crate) async fn get_docs_file(
    Path(raw_project): Path<String>,
    Query(query): Query<PathQuery>,
) -> Response {
    let root = match docs_root(&raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    let path = match DocsPath::parse_markdown(query.path()) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    match reader::read_file(&root, &path) {
        Ok(file) => json_response(StatusCode::OK, &file),
        Err(error) => *failure(error),
    }
}
