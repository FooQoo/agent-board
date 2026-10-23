//! `GET /api/projects/{project_id}/docs/assets?path=`: an image from the Docs.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};

use super::tree::{blocking, project_root};
use super::{PathQuery, failure};
use crate::docs::{DocsPath, reader};
use crate::server::AppState;

/// The policy of an SVG response: no script, no loads, and a sandbox.
const SVG_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

pub(crate) async fn get_docs_asset(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    Query(query): Query<PathQuery>,
) -> Response {
    let root = match project_root(&state, &raw_project) {
        Ok(root) => root,
        Err(response) => return *response,
    };
    let path = match DocsPath::parse(query.path()) {
        Ok(path) => path,
        Err(error) => return *failure(error),
    };
    match blocking(move || reader::read_asset(&root, &path)).await {
        Ok((bytes, content_type)) => {
            let mut response = (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                    // The router's /api/ layer currently overrides this with `no-store`.
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                bytes,
            )
                .into_response();
            // An SVG can carry script, so opening its URL on its own runs none of it.
            if content_type == reader::SVG_TYPE {
                response.headers_mut().insert(
                    header::CONTENT_SECURITY_POLICY,
                    header::HeaderValue::from_static(SVG_POLICY),
                );
            }
            response
        }
        Err(error) => *failure(error),
    }
}
