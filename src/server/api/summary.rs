//! `GET /api/projects/{project_id}/summary`: the Summary from the projection in the index
//! (`server::summary_response`), the same answer as the monitor's.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;

use crate::server::AppState;
use crate::server::summary_response;

pub(super) async fn summary(
    State(state): State<Arc<AppState>>,
    Path(raw_project): Path<String>,
    headers: HeaderMap,
) -> Response {
    summary_response::respond(&state.shared, &state.index, &raw_project, &headers)
}
