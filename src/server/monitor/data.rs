//! The monitor's Summary and Detail routes: the same contract as the PC's, under
//! `/monitor/api/`. The Summary is a stub until the data layer fills it; the Detail routes
//! answer through the PC's functions.

use std::sync::Arc;

use axum::extract::{Path, RawQuery, State};
use axum::response::Response;

use super::router::MonitorState;
use crate::server::api::{Target, detail_response};
use crate::server::response::not_implemented;

pub(super) async fn summary() -> Response {
    not_implemented("The summary")
}

pub(super) async fn task_detail(
    State(state): State<Arc<MonitorState>>,
    Path((project, id)): Path<(String, String)>,
    RawQuery(query): RawQuery,
) -> Response {
    detail_response(
        state.shared.clone(),
        state.index.clone(),
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
        state.shared.clone(),
        state.index.clone(),
        &project,
        Target::Epic(epic),
        query,
    )
    .await
}
