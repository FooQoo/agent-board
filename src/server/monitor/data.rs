//! The monitor's Summary and Detail routes: the same contract as the PC's, under
//! `/monitor/api/`. The handlers are stubs until the data layer fills them.

use std::sync::Arc;

use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;

use super::router::MonitorState;
use crate::server::api::detail_stub;
use crate::server::summary_response;

/// The Summary: the same answer as the PC server's, from the same projection.
pub(super) async fn summary(
    State(state): State<Arc<MonitorState>>,
    Path(raw_project): Path<String>,
    headers: HeaderMap,
) -> Response {
    summary_response::respond(state.shared(), state.index(), &raw_project, &headers)
}

pub(super) async fn task_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The task detail")
}

pub(super) async fn epic_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The epic detail")
}
