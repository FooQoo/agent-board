//! The routes a registered phone uses to subscribe to Web Push. They are behind the session, and
//! a change also passes the Origin, fetch metadata and CSRF checks that the entrance runs first.
//!
//! - `GET /api/remote/push`: whether this session can subscribe (its device is registered), the
//!   public VAPID key to subscribe with, and whether the device already has a subscription.
//! - `PUT /api/remote/push/subscription`: keep the browser's subscription for this device.
//! - `DELETE /api/remote/push/subscription`: forget it.
//!
//! A session that was opened with the passcode but has no registered device cannot subscribe:
//! there would be no way to tell which subscription to drop when the phone is unregistered.

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{Method, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::reply::{json, method_not_allowed, plain};
use crate::server::monitor_auth::contracts::AuthSession;
use crate::server::monitor_auth::guard::is_json;
use crate::server::monitor_connection::push::Invalid;
use crate::server::monitor_connection::router::BackendPolicy;

pub(super) const PUSH_PATH: &str = "/api/remote/push";
const SUBSCRIPTION_PATH: &str = "/api/remote/push/subscription";
/// A real subscription is well under 1 KiB.
const MAX_BODY: usize = 4 * 1024;

#[derive(Deserialize)]
struct Keys {
    p256dh: String,
    auth: String,
}

/// The shape of the browser's `PushSubscription.toJSON()`; other fields are ignored.
#[derive(Deserialize)]
struct Body {
    endpoint: String,
    keys: Keys,
}

fn internal() -> Response {
    plain(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal",
        "could not save the subscription.",
    )
}

fn device_required() -> Response {
    plain(
        StatusCode::CONFLICT,
        "device_required",
        "this browser is not registered as a device. Enter the passcode again to register it.",
    )
}

/// The device the session belongs to, if it is still registered.
fn device_of<'a>(policy: &BackendPolicy, session: &'a AuthSession) -> Option<&'a str> {
    session
        .device_id
        .as_deref()
        .filter(|id| policy.devices.contains(id))
}

pub(super) async fn handle(
    policy: &BackendPolicy,
    session: &AuthSession,
    request: Request,
) -> Response {
    let path = request.uri().path().to_owned();
    let method = request.method().clone();
    match (path.as_str(), method) {
        (PUSH_PATH, Method::GET) => status(policy, session),
        (PUSH_PATH, _) => method_not_allowed("GET"),
        (SUBSCRIPTION_PATH, Method::PUT) => subscribe(policy, session, request).await,
        (SUBSCRIPTION_PATH, Method::DELETE) => unsubscribe(policy, session),
        (SUBSCRIPTION_PATH, _) => method_not_allowed("PUT, DELETE"),
        _ => plain(StatusCode::NOT_FOUND, "not_found", "not found."),
    }
}

fn status(policy: &BackendPolicy, session: &AuthSession) -> Response {
    let Some(device) = device_of(policy, session) else {
        return json(
            StatusCode::OK,
            &serde_json::json!({ "deviceRegistered": false }),
        );
    };
    let Ok(key) = policy.push.public_key() else {
        return internal();
    };
    json(
        StatusCode::OK,
        &serde_json::json!({
            "deviceRegistered": true,
            "publicKey": key,
            "subscribed": policy.push.is_subscribed(device),
        }),
    )
}

async fn subscribe(policy: &BackendPolicy, session: &AuthSession, request: Request) -> Response {
    let Some(device) = device_of(policy, session) else {
        return device_required();
    };
    if !is_json(request.headers()) {
        return plain(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "send the body as application/json.",
        );
    }
    let Ok(bytes) = to_bytes(request.into_body(), MAX_BODY).await else {
        return plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "the request body is too large.",
        );
    };
    let Ok(body) = serde_json::from_slice::<Body>(&bytes) else {
        return plain(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "the body must be a push subscription with an endpoint and keys.",
        );
    };
    match policy
        .push
        .subscribe(device, &body.endpoint, &body.keys.p256dh, &body.keys.auth)
    {
        Ok(Ok(())) => json(StatusCode::OK, &serde_json::json!({ "subscribed": true })),
        Ok(Err(Invalid::Endpoint)) => plain(
            StatusCode::BAD_REQUEST,
            "invalid_subscription",
            "the endpoint must be a public https address.",
        ),
        Ok(Err(Invalid::Keys)) => plain(
            StatusCode::BAD_REQUEST,
            "invalid_subscription",
            "the subscription keys are not valid.",
        ),
        Err(_) => internal(),
    }
}

fn unsubscribe(policy: &BackendPolicy, session: &AuthSession) -> Response {
    let Some(device) = device_of(policy, session) else {
        return device_required();
    };
    match policy.push.unsubscribe(device) {
        Ok(_) => json(StatusCode::OK, &serde_json::json!({ "subscribed": false })),
        Err(_) => internal(),
    }
}
