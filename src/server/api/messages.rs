//! Message routes of the board: questions and requests.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;

use crate::server::AppState;
use crate::server::messages::{
    AnswersInput, answer_questions, list_response, message_response, withdraw_message,
};
use crate::server::messages_send::{answer_questions_multipart, send_request};
use crate::server::request::ApiJson;
use crate::server::response::{agboard_error_response, file_response};
use crate::server::store::{parse_project_id, with_files};

pub(super) async fn message_detail(
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
) -> Response {
    message_response(state.shared.clone(), project, id).await
}

pub(super) async fn message_list(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Query(mut query): Query<HashMap<String, String>>,
) -> Response {
    let status = query.remove("status");
    let kind = query.remove("type");
    let limit = query.remove("limit");
    list_response(state.shared.clone(), project, status, kind, limit).await
}

pub(super) async fn message_answers(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    ApiJson(input): ApiJson<AnswersInput>,
) -> Response {
    answer_questions(headers, state, project, input).await
}

pub(super) async fn message_answers_multipart(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    answer_questions_multipart(headers, state, project, multipart).await
}

pub(super) async fn message_withdraw(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
) -> Response {
    withdraw_message(headers, state, project, id).await
}

pub(super) async fn message_send_request(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> Response {
    send_request(headers, state, project, multipart).await
}

/// `GET …/messages/{id}/attachments/{name}`: an image sent with a message. The name is the
/// file name the body refers to as `attachments/<name>`.
pub(super) async fn message_attachment(
    State(state): State<Arc<AppState>>,
    Path((raw_project, id, name)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match with_files(&state, move |store| {
        store.message_attachment(&project_id, &id, &name)
    })
    .await
    {
        Ok((media_type, bytes)) => file_response(&media_type, bytes),
        Err(error) => agboard_error_response(&error),
    }
}
