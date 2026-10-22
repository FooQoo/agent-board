//! `PUT /api/projects/{project_id}/docs/file`. The write guard in `api` checks
//! the request first.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use super::{docs_root, failure};
use crate::docs::{DocsPath, writer};
use crate::server::request::StrictJson;
use crate::server::response::json_response;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveBody {
    path: String,
    content: String,
    expected_revision: String,
}

pub(crate) async fn put_docs_file(
    Path(raw_project): Path<String>,
    StrictJson(body): StrictJson<SaveBody>,
) -> Response {
    let root = match docs_root(&raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    let path = match DocsPath::parse_markdown(&body.path) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    match writer::save_file(&root, &path, &body.content, &body.expected_revision) {
        Ok(revision) => json_response(
            StatusCode::OK,
            &serde_json::json!({"path": path.as_string(), "revision": revision}),
        ),
        Err(error) => *failure(error),
    }
}
