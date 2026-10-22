//! The JSON error body and the responses every router shares.

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::error::AgboardError;

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
    reason: String,
}

pub(crate) fn error_response(
    status: StatusCode,
    code: &str,
    message: impl Into<String>,
    reason: impl Into<String>,
) -> Response {
    let body = ErrorBody {
        error: ErrorDetail {
            code: code.to_string(),
            message: message.into(),
            reason: reason.into(),
        },
    };
    json_response(status, &body)
}

pub(crate) fn agboard_error_response(error: &AgboardError) -> Response {
    let status = match error {
        AgboardError::TaskNotFound { .. }
        | AgboardError::ProjectNotFound { .. }
        | AgboardError::AttachmentNotFound { .. }
        | AgboardError::EpicNotFound { .. } => StatusCode::NOT_FOUND,
        AgboardError::RequestChanged
        | AgboardError::TaskIsDraft { .. }
        | AgboardError::TaskIsDone { .. }
        | AgboardError::TaskNotDraft { .. }
        | AgboardError::InvalidStateForDraft { .. }
        | AgboardError::ProjectNameExists { .. }
        | AgboardError::EpicIdTaken { .. }
        | AgboardError::EpicInUse { .. } => StatusCode::CONFLICT,
        AgboardError::TaskArchived { .. }
        | AgboardError::TaskNotArchived { .. }
        | AgboardError::ArchiveTargetsChanged
        | AgboardError::OnboardingConflict { .. } => StatusCode::CONFLICT,
        AgboardError::OnboardingInvalid { .. } => StatusCode::UNPROCESSABLE_ENTITY,
        AgboardError::InvalidArgument { .. }
        | AgboardError::InvalidValue { .. }
        | AgboardError::FileInvalid { .. }
        | AgboardError::InvalidStateForColumn { .. }
        | AgboardError::InvalidStateForAssignee
        | AgboardError::RequestChoiceUnknown { .. }
        | AgboardError::AttachmentLimitExceeded => StatusCode::UNPROCESSABLE_ENTITY,
        AgboardError::DatabaseBusy => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_response(status, error.code(), error.message(), error.reason())
}

pub(crate) fn forbidden(reason: &str) -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "forbidden",
        "request is not allowed.",
        reason,
    )
}

pub(crate) fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
    match serde_json::to_vec(body) {
        Ok(bytes) => (
            status,
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// The page holds a token from an earlier server (the server was restarted). Its writes are refused with a
/// code of their own, so the page can ask the person to reload instead of retrying.
pub(crate) fn page_out_of_date() -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "page_out_of_date",
        "The server was restarted, so this page is out of date.",
        "Reload the page to load the current token. Changes made on this page are not saved.",
    )
}

/// A stored file's bytes with the headers that stop a browser from sniffing them.
pub(crate) fn file_response(content_type: &str, bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (header::CACHE_CONTROL, "no-store".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        bytes,
    )
        .into_response()
}
