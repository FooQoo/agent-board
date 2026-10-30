//! The routes that show, begin and end a session.
//!
//! A session starts only at `POST /monitor/api/unlock`, with the passcode of
//! this start. `GET /monitor/api/session` shows the session a cookie already
//! has and starts nothing.

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use serde::Deserialize;

use super::reply::{forbidden, json, method_not_allowed, plain, session_required};
use crate::server::monitor_auth::contracts::{
    AuthSession, SESSION_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME,
};
use crate::server::monitor_auth::guard::{check_same_origin, check_write, is_json, session_cookie};
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

/// `GET /monitor/api/session`: the page asks whether it has a live session. With
/// one it gets the session's CSRF token; without one it is told to enter the
/// passcode. Nothing is issued here.
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
        None => session_required(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UnlockBody {
    code: String,
}

/// `POST /monitor/api/unlock` with `{"code":"1234"}`: trade the passcode for a
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
        Unlock::Granted => start_session(policy),
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

/// A new session for the passcode that was just accepted.
fn start_session(policy: &BackendPolicy) -> Response {
    let Ok(issued) = policy.sessions.issue(policy.origin.origin(), policy.epoch) else {
        return plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "could not start a session.",
        );
    };
    let mut response = json(
        StatusCode::OK,
        &session_body(policy, &issued.csrf, issued.expires_at),
    );
    let cookie = format!(
        "{SESSION_COOKIE_NAME}={}; {SESSION_COOKIE_ATTRIBUTES}; Max-Age={}",
        issued.secret,
        issued.expires_at.saturating_sub(policy.sessions.now())
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// `POST /monitor/api/disconnect`: forget the session and clear its cookie. The
/// passcode keeps working; the page asks for it again.
pub(super) fn disconnect(policy: &BackendPolicy, request: &Request) -> Response {
    if *request.method() != Method::POST {
        return method_not_allowed("POST");
    }
    let Some((secret, session)) = current_session(policy, request.headers()) else {
        return session_required();
    };
    if check_write(request.headers(), &policy.origin, &session).is_err() {
        return forbidden();
    }
    policy.sessions.revoke(&secret);
    let mut response = json(StatusCode::OK, &serde_json::json!({"disconnected": true}));
    let cleared = format!("{SESSION_COOKIE_NAME}=; {SESSION_COOKIE_ATTRIBUTES}; Max-Age=0");
    if let Ok(value) = HeaderValue::from_str(&cleared) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

#[cfg(test)]
mod tests;
