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
use crate::server::messages_send::send_request;
use crate::server::request::ApiJson;

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
