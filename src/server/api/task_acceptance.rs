//! A person checking or unchecking one acceptance condition of a task.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;

use crate::server::AppState;
use crate::server::acceptance::{AcceptanceInput, set_project_task_acceptance};
use crate::server::request::StrictJson;

/// `PUT .../tasks/{id}/acceptance/{condition}`: set one condition to `done`.
pub(super) async fn set_acceptance(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(target): Path<(String, String, String)>,
    StrictJson(input): StrictJson<AcceptanceInput>,
) -> Response {
    set_project_task_acceptance(headers, state, target, input).await
}
