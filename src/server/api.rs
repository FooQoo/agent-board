//! The router: pages, assets, the JSON API and the Host guard.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde::Serialize;

use super::guard::{self, DeleteRequest};
use super::{AppState, assets, events};
use crate::domain::Card;
use crate::error::SkanError;
use crate::store::Store;

pub(crate) fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/assets/app.js", get(app_js))
        .route("/assets/app.css", get(app_css))
        .route("/api/board", get(board))
        .route("/api/events", get(events::events))
        .route("/api/notify", post(notify))
        .route("/api/health", get(health))
        .route("/api/cards/{id}", delete(delete_card))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .with_state(state)
}

// ---------------------------------------------------------------- errors

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

fn error_response(
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

fn skan_error_response(error: &SkanError) -> Response {
    let status = match error {
        SkanError::CardNotFound { .. } => StatusCode::NOT_FOUND,
        SkanError::NotInitialized => StatusCode::CONFLICT,
        SkanError::DatabaseBusy => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    error_response(status, error.code(), error.message(), error.reason())
}

fn forbidden(reason: &str) -> Response {
    error_response(
        StatusCode::FORBIDDEN,
        "forbidden",
        "request is not allowed.",
        reason,
    )
}

fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
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

// ---------------------------------------------------------------- guards

/// The single text value of a header, or `None` if it is absent, repeated or
/// not text.
fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

/// Every request, whatever the path, needs an accepted `Host`.
async fn host_guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    if guard::host_allowed(header_text(request.headers(), "host"), state.port) {
        next.run(request).await
    } else {
        forbidden("Open the board at http://127.0.0.1:<port>/ as printed by skan serve.")
    }
}

// ---------------------------------------------------------------- store access

/// Open the database for one request and run `work` on a blocking thread.
async fn with_store<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(Store) -> Result<T, SkanError> + Send + 'static,
) -> Result<T, SkanError> {
    let path = state.db_path.clone();
    tokio::task::spawn_blocking(move || work(Store::open(&path)?))
        .await
        .map_err(|e| SkanError::DatabaseError {
            reason: format!("The database task failed: {e}"),
        })?
}

// ---------------------------------------------------------------- pages

fn text_response(content_type: &'static str, body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

async fn index(State(state): State<Arc<AppState>>) -> Response {
    text_response(
        "text/html; charset=utf-8",
        assets::render_index(assets::INDEX_HTML, &state.token),
    )
}

async fn app_js() -> Response {
    text_response("text/javascript; charset=utf-8", assets::APP_JS.to_string())
}

async fn app_css() -> Response {
    text_response("text/css; charset=utf-8", assets::APP_CSS.to_string())
}

// ---------------------------------------------------------------- API

#[derive(Serialize)]
struct BoardBody {
    board: BoardView,
    cards: Vec<Card>,
}

#[derive(Serialize)]
struct BoardView {
    name: String,
    #[serde(with = "crate::clock::serde_utc")]
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn board(State(state): State<Arc<AppState>>) -> Response {
    match with_store(&state, |store| store.snapshot()).await {
        Ok(snapshot) => json_response(
            StatusCode::OK,
            &BoardBody {
                board: BoardView {
                    name: snapshot.board.name,
                    created_at: snapshot.board.created_at,
                },
                cards: snapshot.cards,
            },
        ),
        Err(error) => skan_error_response(&error),
    }
}

async fn health() -> Response {
    #[derive(Serialize)]
    struct Health {
        ok: bool,
        pid: u32,
    }
    json_response(
        StatusCode::OK,
        &Health {
            ok: true,
            pid: std::process::id(),
        },
    )
}

/// A change was made elsewhere (the CLI). Tell every connected browser.
async fn notify(State(state): State<Arc<AppState>>) -> StatusCode {
    let _ = state.changed.send(());
    StatusCode::NO_CONTENT
}

async fn delete_card(
    State(state): State<Arc<AppState>>,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let request = DeleteRequest {
        host: header_text(&headers, "host"),
        origin: header_text(&headers, "origin"),
        sec_fetch_site: header_text(&headers, "sec-fetch-site"),
        token: header_text(&headers, "x-skan-token"),
    };
    if guard::check_delete(&request, state.port, &state.token).is_err() {
        return forbidden("Cards can only be deleted from the board page.");
    }
    let Ok(id) = raw_id.parse::<i64>() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "card_not_found",
            format!("card {raw_id} not found."),
            "Card IDs are positive whole numbers.",
        );
    };
    match with_store(&state, move |store| store.delete_card(id)).await {
        Ok(()) => {
            let _ = state.changed.send(());
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => skan_error_response(&error),
    }
}
