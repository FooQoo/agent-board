//! `GET /api/projects/{project_id}/summary`. The handler is a stub until the Summary projection
//! exists; the route and its contract are fixed (`server::contracts::summary`).

use axum::response::Response;

use crate::server::response::not_implemented;

pub(super) async fn summary() -> Response {
    not_implemented("The summary")
}
