//! The monitor's Summary and Detail routes: the same contract as the PC's, under
//! `/monitor/api/`. The handlers are stubs until the data layer fills them.

use axum::extract::RawQuery;
use axum::response::Response;

use crate::server::api::detail_stub;
use crate::server::response::not_implemented;

pub(super) async fn summary() -> Response {
    not_implemented("The summary")
}

pub(super) async fn task_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The task detail")
}

pub(super) async fn epic_detail(RawQuery(query): RawQuery) -> Response {
    detail_stub(query, "The epic detail")
}
