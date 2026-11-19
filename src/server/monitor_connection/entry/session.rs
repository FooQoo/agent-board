//! The routes that show, begin and end a session.
//!
//! A session starts at `POST /api/remote/unlock`, with the passcode of this start, which also
//! registers the device. `GET /api/remote/session` shows the session a cookie already has; a
//! browser with no session but a registered device's cookie gets a new session there without
//! the passcode.

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use serde::Deserialize;

use super::reply::{forbidden, json, method_not_allowed, plain, session_required};
use crate::server::monitor_auth::contracts::{
    AuthSession, DEVICE_COOKIE_MAX_AGE_SECS, DEVICE_COOKIE_NAME, SESSION_COOKIE_ATTRIBUTES,
    SESSION_COOKIE_NAME,
};
use crate::server::monitor_auth::guard::{
    check_same_origin, device_cookie, is_json, session_cookie,
};
use crate::server::monitor_auth::passcode::Unlock;
use crate::server::monitor_auth::session::csrf_for;
use crate::server::monitor_connection::router::BackendPolicy;

/// A passcode is four digits; nothing bigger than this is a real attempt.
const MAX_UNLOCK_BODY: usize = 256;

pub(super) fn current_session(
    policy: &BackendPolicy,
    headers: &HeaderMap,
) -> Option<(String, AuthSession)> {
    let secret = session_cookie(headers)?;
    let session = policy
        .sessions
        .check(&secret, policy.epoch, policy.origin.origin())
        .ok()?;
    Some((secret, session))
}

/// What the page needs to use a session: the CSRF token and how long is left.
fn session_body(policy: &BackendPolicy, csrf: &str, expires_at: u64) -> serde_json::Value {
    serde_json::json!({
        "csrfToken": csrf,
        "expiresAt": expires_at,
        "expiresInSeconds": expires_at.saturating_sub(policy.sessions.now()),
    })
}

/// `GET /api/remote/session`: the page asks whether it has a live session. With
/// one it gets the session's CSRF token. Without one, a registered device's cookie
/// opens a new session; otherwise the page is told to enter the passcode.
pub(super) fn open_session(
    policy: &BackendPolicy,
    method: &Method,
    headers: &HeaderMap,
) -> Response {
    if *method != Method::GET {
        return method_not_allowed("GET");
    }
    let cross_site = headers
        .get_all("sec-fetch-site")
        .iter()
        .any(|v| v.as_bytes() != b"same-origin");
    if cross_site {
        return forbidden();
    }
    match current_session(policy, headers) {
        Some((secret, session)) => json(
            StatusCode::OK,
            &session_body(policy, &csrf_for(&secret), session.expires_at),
        ),
        None => reconnect_device(policy, headers).unwrap_or_else(session_required),
    }
}

/// A new session for a browser whose device cookie is still registered. The cookie is set again
/// so that a device in use stays registered.
fn reconnect_device(policy: &BackendPolicy, headers: &HeaderMap) -> Option<Response> {
    let token = device_cookie(headers)?;
    let device = policy
        .devices
        .authenticate(&token, policy.origin.origin())?;
    let mut response = session_response(policy, Some(device))?;
    set_cookie(&mut response, device_cookie_text(&token));
    Some(response)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UnlockBody {
    code: String,
}

/// `POST /api/remote/unlock` with `{"code":"1234"}`: trade the passcode for a
/// session. It needs the public Origin, same-origin fetch metadata and a JSON
/// body, but no CSRF token, since there is no session yet.
///
/// A wrong passcode is a 403 that says nothing about how close it was or how
/// many tries are left. After five wrong ones in a row every attempt is a 429,
/// the right passcode included, until the connection is started anew.
pub(super) async fn unlock(policy: &BackendPolicy, request: Request) -> Response {
    if *request.method() != Method::POST {
        return method_not_allowed("POST");
    }
    if check_same_origin(request.headers(), &policy.origin).is_err() {
        return forbidden();
    }
    let headers = request.headers().clone();
    if !is_json(request.headers()) {
        return plain(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "send the body as application/json.",
        );
    }
    let Ok(bytes) = to_bytes(request.into_body(), MAX_UNLOCK_BODY).await else {
        return plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "the request body is too large.",
        );
    };
    let Ok(body) = serde_json::from_slice::<UnlockBody>(&bytes) else {
        return plain(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "the body must be {\"code\":\"....\"}.",
        );
    };
    match policy.unlock.try_unlock(&body.code) {
        Unlock::Granted => start_session(policy, &headers),
        Unlock::Wrong => plain(
            StatusCode::FORBIDDEN,
            "unlock_failed",
            "the passcode was not accepted.",
        ),
        Unlock::Locked => plain(
            StatusCode::TOO_MANY_REQUESTS,
            "unlock_locked",
            "too many wrong passcodes. Start the connection again on the PC.",
        ),
    }
}

/// A new session for the passcode that was just accepted. The browser is registered as a
/// device (or, if it already holds a registered device's cookie, that device is kept), so that
/// it can come back without the passcode.
fn start_session(policy: &BackendPolicy, headers: &HeaderMap) -> Response {
    let known = device_cookie(headers).and_then(|token| {
        policy
            .devices
            .authenticate(&token, policy.origin.origin())
            .map(|id| (token, id))
    });
    let (device, new_token) = match known {
        Some((_, id)) => (Some(id), None),
        None => {
            let agent = headers
                .get(header::USER_AGENT)
                .and_then(|v| v.to_str().ok());
            match policy.devices.register(policy.origin.origin(), agent) {
                Ok(registered) => (Some(registered.id), Some(registered.token)),
                // Without a saved registration the phone still gets its session, and asks for
                // the passcode again next time.
                Err(_) => (None, None),
            }
        }
    };
    let Some(mut response) = session_response(policy, device) else {
        return plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "could not start a session.",
        );
    };
    if let Some(token) = new_token {
        set_cookie(&mut response, device_cookie_text(&token));
    }
    response
}

/// The answer that opens a session: its CSRF token and the session cookie.
fn session_response(policy: &BackendPolicy, device: Option<String>) -> Option<Response> {
    let issued = policy
        .sessions
        .issue_for(policy.origin.origin(), policy.epoch, device.clone())
        .ok()?;
    // The device may have been removed between its check and this insert, after the removal
    // already ended the sessions it knew of; such a session must not outlive it.
    if device.is_some_and(|id| !policy.devices.contains(&id)) {
        policy.sessions.revoke(&issued.secret);
        return None;
    }
    let mut response = json(
        StatusCode::OK,
        &session_body(policy, &issued.csrf, issued.expires_at),
    );
    set_cookie(
        &mut response,
        format!(
            "{SESSION_COOKIE_NAME}={}; {SESSION_COOKIE_ATTRIBUTES}; Max-Age={}",
            issued.secret,
            issued.expires_at.saturating_sub(policy.sessions.now())
        ),
    );
    Some(response)
}

fn device_cookie_text(token: &str) -> String {
    format!(
        "{DEVICE_COOKIE_NAME}={token}; {SESSION_COOKIE_ATTRIBUTES}; Max-Age={DEVICE_COOKIE_MAX_AGE_SECS}"
    )
}

fn set_cookie(response: &mut Response, cookie: String) {
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
}

#[cfg(test)]
mod tests;
