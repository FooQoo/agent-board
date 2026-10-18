//! Multipart bodies: the metadata and images of a task edit, and the single
//! file of a text upload.

use axum::extract::Multipart;
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use crate::domain::Assignee;
use crate::server::request::MAX_BODY;
use crate::server::response::error_response;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MultipartMeta {
    pub(super) request_id: String,
    #[serde(default)]
    pub(super) finalize: bool,
    /// Only a new task takes it; an edit refuses it.
    #[serde(default)]
    pub(super) is_draft: Option<bool>,
    #[serde(default)]
    pub(super) title: Option<String>,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) assignee: Option<Assignee>,
    #[serde(default)]
    pub(super) remove_attachment_ids: Vec<String>,
    #[serde(default)]
    pub(super) attachments: Vec<MultipartAttachmentMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MultipartAttachmentMeta {
    pub(super) id: String,
    #[serde(default)]
    pub(super) name: Option<String>,
}

pub(super) struct MultipartPayload {
    pub(super) meta: MultipartMeta,
    pub(super) additions: Vec<crate::domain::AttachmentInput>,
}

pub(super) async fn parse_multipart(
    mut multipart: Multipart,
) -> Result<MultipartPayload, Response> {
    let mut metadata = None;
    let mut files = Vec::new();
    let mut metadata_bytes = 0usize;
    while let Some(field) = multipart.next_field().await.map_err(|_| {
        error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_multipart",
            "request body is invalid.",
            "The multipart body could not be read.",
        )
    })? {
        let name = field.name().unwrap_or_default().to_owned();
        if matches!(name.as_str(), "metadata" | "meta" | "json") {
            let bytes = field.bytes().await.map_err(|_| {
                error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "The metadata part could not be read.",
                )
            })?;
            metadata_bytes += bytes.len();
            if metadata_bytes > MAX_BODY {
                return Err(error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "payload_too_large",
                    "request body is invalid.",
                    "Multipart metadata is limited to 1 MiB.",
                ));
            }
            if metadata.is_some() {
                return Err(error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "Send exactly one metadata part.",
                ));
            }
            metadata = Some(
                serde_json::from_slice::<MultipartMeta>(&bytes).map_err(|_| {
                    error_response(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "invalid_value",
                        "request body is invalid.",
                        "The metadata part is not valid for this route.",
                    )
                })?,
            );
        } else if matches!(
            name.as_str(),
            "file" | "files" | "attachment" | "attachments"
        ) {
            let filename = field.file_name().unwrap_or("attachment").to_owned();
            let bytes = field.bytes().await.map_err(|_| {
                error_response(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_multipart",
                    "request body is invalid.",
                    "An image part could not be read.",
                )
            })?;
            files.push((filename, bytes.to_vec()));
        } else {
            return Err(error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_multipart",
                "request body is invalid.",
                "The multipart body contains an unknown part.",
            ));
        }
    }
    let meta = metadata.ok_or_else(|| {
        error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "A metadata part is required.",
        )
    })?;
    if files.len() > crate::domain::MAX_TASK_ATTACHMENTS {
        return Err(error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "attachment_limit_exceeded",
            "request body is invalid.",
            "A request may contain at most 20 images.",
        ));
    }
    if files.len() != meta.attachments.len() {
        return Err(error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_value",
            "request body is invalid.",
            "Each image must have one attachment metadata entry.",
        ));
    }
    let additions = files
        .into_iter()
        .zip(meta.attachments.iter())
        .map(|((filename, bytes), item)| crate::domain::AttachmentInput {
            id: item.id.clone(),
            name: item.name.clone().unwrap_or(filename),
            bytes,
        })
        .collect();
    Ok(MultipartPayload { meta, additions })
}

pub(super) fn invalid_multipart(reason: &str) -> Response {
    error_response(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_multipart",
        "request body is invalid.",
        reason,
    )
}

pub(super) fn multipart_too_large() -> Response {
    error_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        "payload_too_large",
        "request body is invalid.",
        "Multipart bodies are limited to 52 MiB.",
    )
}

/// The one file of a text upload: its `file` part and the file name sent with it.
pub(super) async fn parse_single_file(
    mut multipart: Multipart,
) -> Result<(String, Vec<u8>), Response> {
    let mut file = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid_multipart("The multipart body could not be read."))?
    {
        if field.name() != Some("file") {
            return Err(invalid_multipart(
                "The multipart body contains an unknown part.",
            ));
        }
        if file.is_some() {
            return Err(invalid_multipart("Send exactly one file part."));
        }
        let name = field.file_name().unwrap_or_default().to_owned();
        let bytes = field
            .bytes()
            .await
            .map_err(|_| invalid_multipart("The file part could not be read."))?;
        file = Some((name, bytes.to_vec()));
    }
    file.ok_or_else(|| invalid_multipart("A file part is required."))
}
