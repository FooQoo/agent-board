//! The PC-only API for the ngrok monitor connection.
//!
//! These routes are on the local board router only; the ngrok
//! entry never gets them. Reads must come from the local page (loopback Host
//! is checked by the router for every request); writes also pass the router's
//! write guard (Origin, Fetch Metadata and the page token). The ngrok token is
//! accepted in the body of `start` only and is never returned. The status carries
//! the phone passcode while the connection is ready, so that the PC can show it.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use crate::server::AppState;
use crate::server::guard::{header_text, origin_allowed};
use crate::server::monitor_connection::contracts::ContractError;
use crate::server::monitor_connection::lifecycle::{
    ForgetError, Secret, SettingsUpdate, Snapshot, StartError, UpdateError,
};
use crate::server::response::{error_response, forbidden, json_response};

const MAX_BODY: usize = 16 * 1024;
const MAX_TOKEN: usize = 512;

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
    snapshot_response(StatusCode::OK, &state.monitor.snapshot())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsBody {
    enabled: bool,
    #[serde(default)]
    domain: Option<String>,
    revision: u64,
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
    let result = state.monitor.update(SettingsUpdate {
        enabled: body.enabled,
        domain: body.domain,
        revision: body.revision,
    });
    match result {
        Ok(snapshot) => snapshot_response(StatusCode::OK, &snapshot),
        Err(UpdateError::Conflict) => error_response(
            StatusCode::CONFLICT,
            "revision_conflict",
            "the settings changed.",
            "Reload the settings and try again.",
        ),
        Err(UpdateError::Invalid(e)) => invalid(&contract_reason(&e)),
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
    /// Also keep the token in the OS keychain. Off unless asked for.
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
        Some(token) => {
            let token = token.trim();
            if token.is_empty()
                || token.len() > MAX_TOKEN
                || token.chars().any(|c| c.is_control() || c.is_whitespace())
            {
                return invalid("the ngrok token is not valid.");
            }
            Some(Secret::new(token))
        }
    };
    match state.monitor.start(token, save) {
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
        Err(StartError::Invalid(e)) => invalid(&contract_reason(&e)),
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
    match state.monitor.forget_token() {
        Ok(snapshot) => snapshot_response(StatusCode::OK, &snapshot),
        Err(ForgetError::KeychainUnavailable) => keychain_unavailable(),
    }
}

fn keychain_unavailable() -> Response {
    error_response(
        StatusCode::CONFLICT,
        "keychain_unavailable",
        "the OS keychain is not available.",
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

/// The contract's messages never include a secret value.
fn contract_reason(e: &ContractError) -> String {
    e.to_string()
}
