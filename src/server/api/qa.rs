//! Project QA routes of the board.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;

use crate::server::AppState;
use crate::server::qa::{
    AnswersInput, WithdrawInput, answer_questions, list_response, question_response,
    withdraw_request,
};
use crate::server::request::ApiJson;

pub(super) async fn qa_question(
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
) -> Response {
    question_response(state.shared.clone(), project, id).await
}

pub(super) async fn qa_list(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Query(mut query): Query<HashMap<String, String>>,
) -> Response {
    let status = query.remove("status");
    let limit = query.remove("limit");
    list_response(state.shared.clone(), project, status, limit).await
}

pub(super) async fn qa_answers(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    ApiJson(input): ApiJson<AnswersInput>,
) -> Response {
    answer_questions(headers, state, project, input).await
}

pub(super) async fn qa_withdraw(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path((project, request_id)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Response {
    // The body is optional: an empty body withdraws without a reason.
    let input = if body.iter().all(u8::is_ascii_whitespace) {
        WithdrawInput::default()
    } else {
        match serde_json::from_slice::<WithdrawInput>(&body) {
            Ok(input) => input,
            Err(e) => {
                return crate::server::response::agboard_error_response(
                    &crate::error::AgboardError::InvalidValue {
                        field: "body".into(),
                        reason: e.to_string(),
                    },
                );
            }
        }
    };
    withdraw_request(headers, state, project, request_id, input).await
}
