//! `GET` and `PUT /api/preferences`: the saved language and color theme on the
//! PC board. The write guard in `api` checks each `PUT` first.

use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;

use super::super::AppState;
use super::super::preferences::http;
use super::super::request::ApiJson;

pub(super) async fn get_preferences(State(state): State<Arc<AppState>>) -> Response {
    http::read(&state.preferences)
}

pub(super) async fn put_preferences(
    State(state): State<Arc<AppState>>,
    ApiJson(body): ApiJson<serde_json::Value>,
) -> Response {
    http::save(&state.preferences, &state.preferences_changed, body)
}
