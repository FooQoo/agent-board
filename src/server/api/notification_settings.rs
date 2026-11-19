//! `GET` and `PUT /api/notification-settings`: which notifications the phone receives. The write
//! guard in `api` checks each `PUT` first.

use std::sync::Arc;

use axum::extract::State;
use axum::response::Response;

use super::super::AppState;
use super::super::notification_settings::http;
use super::super::request::ApiJson;

pub(super) async fn get_notification_settings(State(state): State<Arc<AppState>>) -> Response {
    http::read(&state.notification_settings)
}

pub(super) async fn put_notification_settings(
    State(state): State<Arc<AppState>>,
    ApiJson(body): ApiJson<serde_json::Value>,
) -> Response {
    http::save(&state.notification_settings, body)
}
