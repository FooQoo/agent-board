//! Project QA over HTTP: reading questions, answering several at once, and withdrawing a
//! request. The local board and the monitor's write endpoint save answers through here.

use std::path::PathBuf;
use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use super::AppState;
use super::response::{agboard_error_response, json_response};
use super::store::{parse_project_id, refresh_index, with_request_files};
use crate::domain::Actor;
use crate::error::AgboardError;
use crate::file_store::qa::{AnswerVia, QuestionStatus, QuestionView};
use crate::file_store::{AnswerItem, FileStore};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnswerInputItem {
    question_id: String,
    #[serde(default)]
    choice_id: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnswersInput {
    answers: Vec<AnswerInputItem>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WithdrawInput {
    #[serde(default)]
    reason: Option<String>,
}

/// Run blocking file work against the shared folder.
async fn on_files<T: Send + 'static>(
    shared: PathBuf,
    work: impl FnOnce(FileStore) -> Result<T, AgboardError> + Send + 'static,
) -> Result<T, AgboardError> {
    tokio::task::spawn_blocking(move || work(FileStore::open(&shared)))
        .await
        .map_err(|e| AgboardError::DatabaseError {
            reason: format!("The file task failed: {e}"),
        })?
}

/// `GET …/qa/{questionId}`: one question with its answer and the tasks that refer to it.
pub(crate) async fn question_response(
    shared: PathBuf,
    raw_project: String,
    id: String,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    match on_files(shared, move |store| store.question(&project, &id)).await {
        Ok(question) => json_response(StatusCode::OK, &serde_json::json!({ "question": question })),
        Err(error) => agboard_error_response(&error),
    }
}

/// `GET …/qa?status=…&limit=…`: questions of one status, newest first.
pub(crate) async fn list_response(
    shared: PathBuf,
    raw_project: String,
    status: Option<String>,
    limit: Option<String>,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let invalid = |field: &str, reason: &str| {
        agboard_error_response(&AgboardError::InvalidValue {
            field: field.into(),
            reason: reason.into(),
        })
    };
    let status = match status.as_deref().unwrap_or("answered") {
        "open" => Some(QuestionStatus::Open),
        "answered" => Some(QuestionStatus::Answered),
        "withdrawn" => Some(QuestionStatus::Withdrawn),
        "all" => None,
        _ => return invalid("status", "status is open, answered, withdrawn, or all."),
    };
    let limit = match limit.as_deref().map(str::parse::<usize>) {
        None => 50,
        Some(Ok(n)) if (1..=500).contains(&n) => n,
        Some(_) => return invalid("limit", "limit is a number from 1 to 500."),
    };
    match on_files(shared, move |store| store.questions(&project)).await {
        Ok(questions) => {
            let mut picked: Vec<QuestionView> = questions
                .into_iter()
                .filter(|q| status.is_none_or(|s| q.status == s))
                .collect();
            picked.sort_by_key(|q| std::cmp::Reverse(q.number()));
            picked.truncate(limit);
            json_response(StatusCode::OK, &serde_json::json!({ "questions": picked }))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// A refusal because some questions were answered or withdrawn first: the standard error,
/// the two ID lists, and the questions as they are recorded now.
fn conflict_response(
    store: &FileStore,
    project: &str,
    ids: &[String],
    error: &AgboardError,
) -> Response {
    let questions: Vec<QuestionView> = project
        .parse()
        .ok()
        .and_then(|p| store.questions(&p).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|q| ids.contains(&q.id))
        .collect();
    let of = |status: QuestionStatus| -> Vec<&str> {
        questions
            .iter()
            .filter(|q| q.status == status)
            .map(|q| q.id.as_str())
            .collect()
    };
    let recorded: Vec<&QuestionView> = questions
        .iter()
        .filter(|q| q.status != QuestionStatus::Open)
        .collect();
    json_response(
        StatusCode::CONFLICT,
        &serde_json::json!({
            "error": {
                "code": error.code(),
                "message": error.message(),
                "reason": error.reason(),
            },
            "questionAnswered": of(QuestionStatus::Answered),
            "questionWithdrawn": of(QuestionStatus::Withdrawn),
            "questions": recorded,
        }),
    )
}

/// `POST …/qa/answers`: a person's answers, written together or not at all.
pub(crate) async fn answer_questions(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    input: AnswersInput,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let ids: Vec<String> = input
        .answers
        .iter()
        .map(|a| a.question_id.clone())
        .collect();
    let items = input
        .answers
        .into_iter()
        .map(|a| AnswerItem {
            question_id: a.question_id,
            choice_id: a.choice_id,
            text: a.text,
        })
        .collect();
    let result = with_request_files(&state, &headers, move |store| {
        Ok(
            match store.answer_questions(&project, items, AnswerVia::Ui, chrono::Utc::now()) {
                Ok(questions) => Ok(questions),
                Err(
                    error @ (AgboardError::QuestionAnswered { .. }
                    | AgboardError::QuestionWithdrawn { .. }),
                ) => Err(Ok(conflict_response(&store, &raw_project, &ids, &error))),
                Err(error) => Err(Err(error)),
            },
        )
    })
    .await;
    match result {
        Ok(Ok(questions)) => {
            refresh_index(&state);
            json_response(
                StatusCode::OK,
                &serde_json::json!({ "questions": questions }),
            )
        }
        Ok(Err(Ok(conflict))) => conflict,
        Ok(Err(Err(error))) | Err(error) => agboard_error_response(&error),
    }
}

/// `POST …/qa/requests/{requestId}/withdraw`: a person withdraws a request.
pub(crate) async fn withdraw_request(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    request_id: String,
    input: WithdrawInput,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.withdraw_request(
            &project,
            &request_id,
            Actor::Human,
            input.reason.as_deref(),
            chrono::Utc::now(),
        )?;
        store.request(&project, &request_id)
    })
    .await;
    match result {
        Ok((request, questions)) => {
            refresh_index(&state);
            json_response(
                StatusCode::OK,
                &serde_json::json!({
                    "requestId": request.request_id,
                    "withdrawnAt": request.withdrawn_at.map(crate::clock::format_utc),
                    "withdrawReason": request.withdraw_reason,
                    "questions": questions,
                }),
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}
