//! The request handling of `/api/notification-settings`, served on the PC and through the ngrok
//! entrance. Each entrance checks its own guards first; these functions only read and save.

use axum::http::StatusCode;
use axum::response::Response;

use super::{NotificationSettingsStore, Patch, UpdateError};
use crate::server::response::{error_response, json_response};

pub(crate) fn read(store: &NotificationSettingsStore) -> Response {
    json_response(StatusCode::OK, &store.load())
}

/// Takes the body as raw JSON first, so that an unknown field or an invalid
/// value is one `invalid_notification_settings` error, and nothing is saved.
pub(crate) fn save(store: &NotificationSettingsStore, body: serde_json::Value) -> Response {
    let patch = match serde_json::from_value::<Patch>(body) {
        Ok(patch) => patch,
        Err(_) => return invalid(),
    };
    match store.update(patch) {
        Ok(saved) => json_response(StatusCode::OK, &saved),
        Err(UpdateError::Invalid) => invalid(),
        Err(UpdateError::Unavailable) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "notification_settings_unavailable",
            "notification settings could not be saved.",
            "The notification settings file could not be written. The saved value is unchanged.",
        ),
    }
}

fn invalid() -> Response {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_notification_settings",
        "notification settings are invalid.",
        "Send kinds with all of its fields (results, questions, history, and summary, each true or false), summary.intervalMinutes (0, 30, 60, 120, or 240), or both.",
    )
}
