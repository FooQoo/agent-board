//! The monitor's Summary and Detail routes: the same contract as the PC's, under
//! `/monitor/api/`. The Summary is a stub until the data layer fills it; the Detail routes
//! answer through the PC's functions.

use std::sync::Arc;

use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::Response;

use super::router::MonitorState;
use crate::server::api::{Target, detail_response};
use crate::server::summary_response;

/// The Summary: the same answer as the PC server's, from the same projection.
pub(super) async fn summary(
    State(state): State<Arc<MonitorState>>,
    Path(raw_project): Path<String>,
    headers: HeaderMap,
) -> Response {
    summary_response::respond(state.shared(), state.index(), &raw_project, &headers)
}

pub(super) async fn task_detail(
    State(state): State<Arc<MonitorState>>,
    Path((project, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    detail_response(
        state.shared(),
        state.index(),
        &project,
        Target::Task(id),
        query,
    )
    .await
}

pub(super) async fn epic_detail(
    State(state): State<Arc<MonitorState>>,
    Path((project, epic)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    detail_response(
        state.shared(),
        state.index(),
        &project,
        Target::Epic(epic),
        query,
    )
    .await
}
