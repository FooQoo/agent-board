//! `GET /api/projects/{project_id}/docs/tree`.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::Response;

use super::{docs_root, failure};
use crate::docs::reader;
use crate::server::response::json_response;

pub(crate) async fn get_docs_tree(Path(raw_project): Path<String>) -> Response {
    let root = match docs_root(&raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    match reader::read_tree(&root) {
        Ok(tree) => json_response(StatusCode::OK, &tree),
        Err(error) => *failure(error),
    }
}
