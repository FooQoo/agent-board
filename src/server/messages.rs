//! Messages over HTTP: reading them, answering several questions at once, sending and
//! withdrawing requests. The local board and the monitor's write endpoint save through here.

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
use crate::file_store::qa::{AnswerVia, MessageView, QuestionStatus, QuestionView};
use crate::file_store::{AnswerItem, FileStore};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnswerInputItem {
    pub(super) question_id: String,
    #[serde(default)]
    pub(super) choice_id: Option<String>,
    #[serde(default)]
    pub(super) text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnswersInput {
    pub(super) answers: Vec<AnswerInputItem>,
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

/// `GET …/messages/{id}`: one message. A question comes with its reply and the tasks that
/// refer to it; a request with its acceptance.
pub(crate) async fn message_response(shared: PathBuf, raw_project: String, id: String) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    match on_files(shared, move |store| store.message(&project, &id)).await {
        Ok(MessageView::Question(question)) => {
            json_response(StatusCode::OK, &serde_json::json!({ "question": question }))
        }
        Ok(MessageView::Request(request)) => {
            json_response(StatusCode::OK, &serde_json::json!({ "request": request }))
        }
        Err(error) => agboard_error_response(&error),
    }
}

/// `GET …/messages?status=…&type=…&limit=…`: messages, newest first.
pub(crate) async fn list_response(
    shared: PathBuf,
    raw_project: String,
    status: Option<String>,
    kind: Option<String>,
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
    let status = match status.as_deref().unwrap_or("open") {
        "open" => Some("open"),
        "closed" => Some("closed"),
        "withdrawn" => Some("withdrawn"),
        "all" => None,
        _ => return invalid("status", "status is open, closed, withdrawn, or all."),
    };
    let kind = match kind.as_deref() {
        None => None,
        Some(k @ ("question" | "request")) => Some(k),
        Some(_) => return invalid("type", "type is question or request."),
    };
    let limit = match limit.as_deref().map(str::parse::<usize>) {
        None => 50,
        Some(Ok(n)) if (1..=500).contains(&n) => n,
        Some(_) => return invalid("limit", "limit is a number from 1 to 500."),
    };
    match on_files(shared, move |store| store.messages(&project)).await {
        Ok(messages) => {
            let mut picked: Vec<MessageView> = messages
                .into_iter()
                .filter(|m| status.is_none_or(|s| m.state() == s))
                .filter(|m| {
                    kind.is_none_or(|k| match m {
                        MessageView::Question(_) => k == "question",
                        MessageView::Request(_) => k == "request",
                    })
                })
                .collect();
            picked.sort_by_key(|m| std::cmp::Reverse(m.number()));
            picked.truncate(limit);
            json_response(StatusCode::OK, &serde_json::json!({ "messages": picked }))
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

/// `POST …/messages/answers`: a person's answers, written together or not at all.
pub(crate) async fn answer_questions(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    input: AnswersInput,
) -> Response {
    let items = input
        .answers
        .into_iter()
        .map(|a| AnswerItem {
            question_id: a.question_id,
            choice_id: a.choice_id,
            text: a.text,
            images: Vec::new(),
        })
        .collect();
    record_answers(headers, state, raw_project, items).await
}

pub(super) async fn record_answers(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    items: Vec<AnswerItem>,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let ids: Vec<String> = items.iter().map(|a| a.question_id.clone()).collect();
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

/// `POST …/messages/{id}/withdraw`: a person withdraws a request.
pub(crate) async fn withdraw_message(
    headers: HeaderMap,
    state: Arc<AppState>,
    raw_project: String,
    id: String,
) -> Response {
    let project = match parse_project_id(&raw_project) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let result = with_request_files(&state, &headers, move |store| {
        store.withdraw_message(&project, &id, Actor::Human, chrono::Utc::now())
    })
    .await;
    match result {
        Ok(changed) => {
            refresh_index(&state);
            let body = match changed.value {
                MessageView::Question(q) => serde_json::json!({ "question": q }),
                MessageView::Request(r) => serde_json::json!({ "request": r }),
            };
            json_response(StatusCode::OK, &body)
        }
        Err(error) => agboard_error_response(&error),
    }
}
