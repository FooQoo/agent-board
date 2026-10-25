//! The request handling shared by the PC board (`/api/preferences`) and the
//! ngrok monitor (`/monitor/api/preferences`). Each route checks its own
//! guards first; these functions only read and save.

use axum::http::StatusCode;
use axum::response::Response;
use tokio::sync::broadcast;

use super::{Patch, Preferences, PreferencesStore, UpdateError};
use crate::server::response::{error_response, json_response};

pub(crate) fn read(store: &PreferencesStore) -> Response {
    json_response(StatusCode::OK, &store.load())
}

/// Takes the body as raw JSON first, so that an unknown field or an invalid
/// value is one `invalid_preferences` error, and nothing is saved.
pub(crate) fn save(
    store: &PreferencesStore,
    changed: &broadcast::Sender<Preferences>,
    body: serde_json::Value,
) -> Response {
    let patch = match serde_json::from_value::<Patch>(body) {
        Ok(patch) => patch,
        Err(_) => return invalid(),
    };
    match store.update(patch) {
        Ok(saved) => {
            // Every open board and monitor page applies the change.
            let _ = changed.send(saved.clone());
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
