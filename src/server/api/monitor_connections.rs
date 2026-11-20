//! The PC-only API for the ngrok monitor connection.
//!
//! These routes are on the local board router only; the ngrok
//! entry never gets them. Reads must come from the local page (loopback Host
//! is checked by the router for every request); writes also pass the router's
//! write guard (Origin, Fetch Metadata and the page token). The ngrok token is
//! accepted in the body of `start` only and is never returned. The status carries
//! the phone passcode while the connection is ready, so that the PC can show it.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post, put};
use serde::Deserialize;

use crate::server::AppState;
use crate::server::guard::{header_text, origin_allowed};
use crate::server::monitor_connection::lifecycle::{
    ForgetError, SettingsUpdate, Snapshot, StartError, UpdateError, parse_domain, parse_token,
};
use crate::server::response::{error_response, forbidden, json_response};

/// The connection routes. They are on the local listener only; the entrance never serves them.
pub(super) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/monitor-connections", get(get_connections))
        .route(
            "/api/monitor-connections/settings/ngrok",
            put(put_ngrok_settings),
        )
        .route(
            "/api/monitor-connections/transports/ngrok/start",
            post(start_ngrok),
        )
        .route(
            "/api/monitor-connections/transports/ngrok/stop",
            post(stop_ngrok),
        )
        .route("/api/monitor-connections/token", delete(delete_saved_token))
        .route("/api/monitor-connections/devices", get(list_devices))
        .route(
            "/api/monitor-connections/devices/{device_id}",
            delete(remove_device),
        )
}

const MAX_BODY: usize = 16 * 1024;

/// A read must not come from another site: a cross-site Fetch Metadata or a
/// foreign Origin is refused.
fn local_read(headers: &HeaderMap, port: u16) -> Result<(), Box<Response>> {
    let site_ok =
        header_text(headers, "sec-fetch-site").is_none_or(|s| s == "same-origin" || s == "none");
    let origin_ok =
        !headers.contains_key("origin") || origin_allowed(header_text(headers, "origin"), port);
    if site_ok && origin_ok {
        Ok(())
    } else {
        Err(Box::new(forbidden(
            "Open the board at http://127.0.0.1:<port>/ as printed by agboard serve.",
        )))
    }
}

fn snapshot_response(status: StatusCode, snapshot: &Snapshot) -> Response {
    json_response(status, snapshot)
}

pub(super) async fn get_connections(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Response {
    if let Err(r) = local_read(request.headers(), state.port) {
        return *r;
    }
    snapshot_response(StatusCode::OK, &state.monitor.snapshot().await)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsBody {
    enabled: bool,
    revision: u64,
    /// Absent keeps the saved domain; an empty string clears it.
    #[serde(default)]
    domain: Option<String>,
}

/// The domain a request asks to save: `None` keeps it, `Some(None)` clears it.
#[allow(clippy::option_option)]
fn requested_domain(raw: Option<String>) -> Result<Option<Option<String>>, Box<Response>> {
    match raw {
        None => Ok(None),
        Some(text) if text.trim().is_empty() => Ok(Some(None)),
        Some(text) => match parse_domain(&text) {
            Some(domain) => Ok(Some(Some(domain))),
            None => Err(Box::new(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_domain",
                "the ngrok domain is not valid.",
                "Enter a host name only, such as example.ngrok-free.dev, without https://, a path, or a port.",
            ))),
        },
    }
}

pub(super) async fn put_ngrok_settings(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Response {
    if body.len() > MAX_BODY {
        return invalid("request body is too large.");
    }
    let Ok(body) = serde_json::from_slice::<SettingsBody>(&body) else {
        return invalid("settings are malformed.");
    };
    let domain = match requested_domain(body.domain) {
        Ok(domain) => domain,
        Err(r) => return *r,
    };
    let result = state.monitor.update(SettingsUpdate {
        enabled: body.enabled,
        revision: body.revision,
        domain,
    });
    match result {
        Ok(snapshot) => snapshot_response(StatusCode::OK, &snapshot),
        Err(UpdateError::Conflict) => error_response(
            StatusCode::CONFLICT,
            "revision_conflict",
            "the settings changed.",
            "Reload the settings and try again.",
        ),
        Err(UpdateError::SaveFailed) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "save_failed",
            "the settings could not be saved.",
            "Nothing was changed and the connection was not started.",
        ),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StartBody {
    #[serde(default)]
    token: Option<String>,
    /// Also keep the token in this PC's secure storage (the OS keychain). Off unless asked for.
    #[serde(default)]
    save: bool,
}

pub(super) async fn start_ngrok(State(state): State<Arc<AppState>>, body: Bytes) -> Response {
    if body.len() > MAX_BODY {
        return invalid("request body is too large.");
    }
    let parsed = if body.is_empty() {
        StartBody {
            token: None,
            save: false,
        }
    } else {
        match serde_json::from_slice::<StartBody>(&body) {
            Ok(parsed) => parsed,
            Err(_) => return invalid("the request is malformed."),
        }
    };
    if parsed.save && parsed.token.is_none() {
        return invalid("save needs a token to save.");
    }
    let save = parsed.save;
    let token = match parsed.token {
        None => None,
        Some(token) => match parse_token(&token) {
            Some(token) => Some(token),
            None => return invalid("the ngrok token is not valid."),
        },
    };
    match state.monitor.start(token, save).await {
        Ok(snapshot) => snapshot_response(StatusCode::ACCEPTED, &snapshot),
        Err(StartError::TokenRequired) => error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "token_required",
            "an ngrok token is required.",
            "Enter the token to start the connection.",
        ),
        Err(StartError::KeychainUnavailable) => keychain_unavailable(),
        Err(StartError::SettingsUnreadable) => error_response(
            StatusCode::CONFLICT,
            "settings_unreadable",
            "the saved settings could not be read.",
            "Save the settings again before starting.",
        ),
        Err(StartError::SaveFailed) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "save_failed",
            "the settings could not be saved.",
            "Nothing was changed and the connection was not started.",
        ),
        Err(StartError::Internal) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "start_failed",
            "the connection could not be started.",
            "Try again.",
        ),
    }
}

/// Remove the token saved in the OS keychain.
pub(super) async fn delete_saved_token(State(state): State<Arc<AppState>>) -> Response {
    match state.monitor.forget_token().await {
        Ok(snapshot) => snapshot_response(StatusCode::OK, &snapshot),
        Err(ForgetError::KeychainUnavailable) => keychain_unavailable(),
    }
}

/// The registered phones and browsers, the one seen last first. No token or digest is in it.
pub(super) async fn list_devices(State(state): State<Arc<AppState>>, request: Request) -> Response {
    if let Err(r) = local_read(request.headers(), state.port) {
        return *r;
    }
    json_response(
        StatusCode::OK,
        &serde_json::json!({ "devices": state.monitor.devices() }),
    )
}

/// Unregister a device: its sessions and open event streams end at once.
pub(super) async fn remove_device(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<String>,
) -> Response {
    match state.monitor.remove_device(&device_id) {
        Ok(true) => json_response(
            StatusCode::OK,
            &serde_json::json!({ "devices": state.monitor.devices() }),
        ),
        Ok(false) => error_response(
            StatusCode::NOT_FOUND,
            "device_not_found",
            "that device is not registered.",
            "Reload the list; it may have been removed already.",
        ),
        Err(_) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "save_failed",
            "the device list could not be saved.",
            "Nothing was changed.",
        ),
    }
}

fn keychain_unavailable() -> Response {
    error_response(
        StatusCode::CONFLICT,
        "keychain_unavailable",
        "secure storage on this PC is not available.",
        "Enter the token each time instead; nothing was saved or changed.",
    )
}

pub(super) async fn stop_ngrok(State(state): State<Arc<AppState>>) -> Response {
    snapshot_response(StatusCode::OK, &state.monitor.stop())
}

fn invalid(reason: &str) -> Response {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_value",
        "the value is invalid.",
        reason,
    )
}
