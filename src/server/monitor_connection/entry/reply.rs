//! The small JSON answers of the entry.

use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;

pub(super) fn json(status: StatusCode, value: &serde_json::Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(value.to_string()))
        .unwrap_or_default()
}

pub(super) fn plain(status: StatusCode, code: &str, message: &str) -> Response {
    json(
        status,
        &serde_json::json!({"error": {"code": code, "message": message}}),
    )
}

pub(super) fn forbidden() -> Response {
    plain(
        StatusCode::FORBIDDEN,
        "forbidden",
        "request is not allowed.",
    )
}

pub(super) fn session_required() -> Response {
    plain(
        StatusCode::UNAUTHORIZED,
        "session_required",
        "enter the passcode.",
    )
}

pub(super) fn method_not_allowed(allow: &'static str) -> Response {
    let mut response = plain(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "method not allowed.",
    );
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(allow));
    response
}
