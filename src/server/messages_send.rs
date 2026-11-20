//! Sending a request over HTTP: a multipart body with the text and its images.

use std::sync::Arc;

use axum::extract::Multipart;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use super::AppState;
use super::messages::{AnswersInput, record_answers};
use super::response::{agboard_error_response, json_response};
use super::store::{parse_project_id, refresh_index, with_request_files};
use crate::error::AgboardError;
use crate::file_store::{AnswerItem, RequestImage, SendRequestInput};

/// `POST …/messages/requests`: a person sends a request. The multipart body has a `text` part
/// and any number of image parts (`images`), each stored as `attachments/<file name>`.
pub(crate) async fn send_request(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(mut multipart) = multipart else {
        return invalid_body("The body must be multipart/form-data.");
    };
    let mut text = None;
    let mut images = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return invalid_body("The multipart body could not be read."),
        };
        let name = field.name().unwrap_or_default().to_owned();
        let file_name = field.file_name().map(str::to_owned);
        let Ok(bytes) = field.bytes().await else {
            return invalid_body("A multipart part could not be read.");
        };
        match (name.as_str(), file_name) {
            ("text", None) => match String::from_utf8(bytes.to_vec()) {
                Ok(value) if text.is_none() => text = Some(value),
                _ => return invalid_body("text is sent once, as UTF-8."),
            },
            ("images", Some(file_name)) => images.push(RequestImage {
                name: file_name,
                bytes: bytes.to_vec(),
            }),
            _ => return invalid_body("Parts are text and images."),
        }
    }
    let Some(text) = text else {
        return invalid_body("text is required.");
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.send_request(
            &project,
            SendRequestInput { text, images },
            chrono::Utc::now(),
        )
    })
    .await;
    match result {
        Ok(request) => {
            refresh_index(&state);
            json_response(
                StatusCode::CREATED,
                &serde_json::json!({ "request": request }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

fn invalid_body(reason: &str) -> Response {
    agboard_error_response(&AgboardError::InvalidValue {
        field: "body".into(),
        reason: reason.into(),
    })
}

/// `POST …/messages/answers/multipart`: the same answers with images. The body has one
/// `metadata` part (the JSON of `POST …/messages/answers`) and image parts named
/// `images.<questionId>`, each stored under that question's `attachments/` folder.
pub(crate) async fn answer_questions_multipart(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    multipart: Result<axum::extract::Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    let invalid_body = |reason: &str| {
        agboard_error_response(&AgboardError::InvalidValue {
            field: "body".into(),
            reason: reason.into(),
        })
    };
    let Ok(mut multipart) = multipart else {
        return invalid_body("The body must be multipart/form-data.");
    };
    let mut input: Option<AnswersInput> = None;
    let mut images: Vec<(String, RequestImage)> = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(_) => return invalid_body("The multipart body could not be read."),
        };
        let name = field.name().unwrap_or_default().to_owned();
        let file_name = field.file_name().map(str::to_owned);
        let Ok(bytes) = field.bytes().await else {
            return invalid_body("A multipart part could not be read.");
        };
        match (name.as_str(), file_name) {
            ("metadata", None) if input.is_none() => match serde_json::from_slice(&bytes) {
                Ok(value) => input = Some(value),
                Err(_) => return invalid_body("metadata is not the JSON of the answers."),
            },
            (part, Some(file_name)) if part.starts_with("images.") => images.push((
                part["images.".len()..].to_owned(),
                RequestImage {
                    name: file_name,
                    bytes: bytes.to_vec(),
                },
            )),
            _ => return invalid_body("Parts are metadata once and images.<questionId>."),
        }
    }
    let Some(input) = input else {
        return invalid_body("metadata is required.");
    };
    if images
        .iter()
        .any(|(id, _)| !input.answers.iter().any(|a| &a.question_id == id))
    {
        return invalid_body("An image names a question that is not answered.");
    }
    // Each answer is built with the images of its question, so a repeated ID would copy the
    // uploaded bytes once per repeat. The store refuses it in the same words, but only later.
    if let Some(repeated) = repeated_answer(&input.answers) {
        return agboard_error_response(&AgboardError::InvalidValue {
            field: "answers".into(),
            reason: format!("{repeated} is answered twice."),
        });
    }
    let items = input
        .answers
        .into_iter()
        .map(|a| {
            let mine = images
                .iter()
                .filter(|(id, _)| *id == a.question_id)
                .map(|(_, image)| image.clone())
                .collect();
            AnswerItem {
                question_id: a.question_id,
                choice_id: a.choice_id,
                text: a.text,
                images: mine,
            }
        })
        .collect();
    record_answers(headers, state, raw_project, items).await
}

/// The first question ID that more than one answer names.
fn repeated_answer(answers: &[super::messages::AnswerInputItem]) -> Option<&str> {
    let mut seen = std::collections::HashSet::new();
    answers
        .iter()
        .map(|a| a.question_id.as_str())
        .find(|id| !seen.insert(*id))
}
