//! `GET` and `PUT /api/preferences`: the saved language and color theme. The
//! PC board is the only writer; the monitor's route is added with the monitor.

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;

use super::super::AppState;
use super::super::request::ApiJson;
use super::super::response::{error_response, json_response};
use crate::server::preferences::{Patch, UpdateError};

pub(super) async fn get_preferences(State(state): State<Arc<AppState>>) -> Response {
    json_response(StatusCode::OK, &state.preferences.load())
}

/// Takes the body as raw JSON first, so that an unknown field or an invalid
/// value is one `invalid_preferences` error, and nothing is saved.
pub(super) async fn put_preferences(
    State(state): State<Arc<AppState>>,
    ApiJson(body): ApiJson<serde_json::Value>,
) -> Response {
    let patch = match serde_json::from_value::<Patch>(body) {
        Ok(patch) => patch,
        Err(_) => return invalid(),
    };
    match state.preferences.update(patch) {
        Ok(saved) => {
            // Each open page on this board, and the monitor, applies the change.
            let _ = state.preferences_changed.send(saved.clone());
            json_response(StatusCode::OK, &saved)
        }
        Err(UpdateError::Invalid) => invalid(),
        Err(UpdateError::Unavailable) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "preferences_unavailable",
            "preferences could not be saved.",
            "The preferences file could not be written. The saved value is unchanged.",
        ),
    }
}

fn invalid() -> Response {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_preferences",
        "preferences are invalid.",
        "Only locale (en or ja) and theme (light or dark mode, one of the 12 accents) can be saved.",
    )
}
