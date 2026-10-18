//! JSON request bodies whose failures use the API's error body.

use axum::body::to_bytes;
use axum::extract::{FromRequest, Request};
use axum::http::{StatusCode, header};
use axum::response::Response;

use super::response::error_response;

/// The largest request body any route reads. A description of 50,000
/// characters can be about 150 KB of JSON, so this leaves room for that.
pub(crate) const MAX_BODY: usize = 1024 * 1024;

/// A JSON body whose failures use the API's error body: 400 for broken JSON,
/// 413 for a body over the limit, 415 for another content type, and 422 for
/// JSON that is well formed but not what the route takes.
pub(crate) struct ApiJson<T>(pub(crate) T);

impl<S: Send + Sync, T: serde::de::DeserializeOwned> FromRequest<S> for ApiJson<T> {
    type Rejection = Response;

    async fn from_request(request: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !content_type
            .split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "request body is invalid.",
                "Send the body as application/json.",
            ));
        }
        let body = to_bytes(request.into_body(), MAX_BODY).await.map_err(|_| {
            error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Request bodies are limited to 1 MiB.",
            )
        })?;
        match serde_json::from_slice::<T>(&body) {
            Ok(value) => Ok(ApiJson(value)),
            Err(error) if error.is_data() => Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "The body is missing a field or has a value the route does not accept.",
            )),
            Err(_) => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body is not valid JSON.",
            )),
        }
    }
}

/// Like [`ApiJson`], but a field the route does not take is a broken request
/// (400) rather than a value it does not accept (422).
pub(crate) struct StrictJson<T>(pub(crate) T);

impl<S: Send + Sync, T: serde::de::DeserializeOwned> FromRequest<S> for StrictJson<T> {
    type Rejection = Response;

    async fn from_request(request: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !content_type
            .split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        {
            return Err(error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "request body is invalid.",
                "Send the body as application/json.",
            ));
        }
        let body = to_bytes(request.into_body(), MAX_BODY).await.map_err(|_| {
            error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload_too_large",
                "request body is invalid.",
                "Request bodies are limited to 1 MiB.",
            )
        })?;
        match serde_json::from_slice::<T>(&body) {
            Ok(value) => Ok(StrictJson(value)),
            Err(error) if error.to_string().contains("unknown field") => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body has a field this route does not take.",
            )),
            Err(error) if error.is_data() => Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_value",
                "request body is invalid.",
                "The body is missing a field or has a value the route does not accept.",
            )),
            Err(_) => Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "request body is invalid.",
                "The body is not valid JSON.",
            )),
        }
    }
}
