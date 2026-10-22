//! `GET /api/projects/{project_id}/docs/assets?path=`: an image from the Docs.

use axum::extract::{Path, Query};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};

use super::{PathQuery, docs_root, failure};
use crate::docs::{DocsPath, reader};

pub(crate) async fn get_docs_asset(
    Path(raw_project): Path<String>,
    Query(query): Query<PathQuery>,
) -> Response {
    let root = match docs_root(&raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    let path = match DocsPath::parse(query.path()) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    match reader::read_asset(&root, &path) {
        Ok((bytes, content_type)) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response(),
        Err(error) => *failure(error),
    }
}
