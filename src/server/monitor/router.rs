//! The isolated read-only monitor router. Its state has no write service or token.

use std::collections::HashSet;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::{any, get};
use futures_util::stream::{self, Stream, StreamExt};
use tokio::sync::broadcast;

use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::index::ProjectIndex;
use crate::file_store::model::AttachmentOwner;
use crate::file_store::validate::EpicId;
use crate::server::api;

#[derive(Clone)]
pub(crate) struct MonitorState {
    shared: PathBuf,
    index: Arc<RwLock<ProjectIndex>>,
    changed: broadcast::Sender<()>,
    allowed_authorities: Arc<HashSet<String>>,
}

impl MonitorState {
    pub(crate) fn new(
        shared: PathBuf,
        index: Arc<RwLock<ProjectIndex>>,
        changed: broadcast::Sender<()>,
        allowed_authorities: HashSet<String>,
    ) -> Self {
        Self {
            shared,
            index,
            changed,
            allowed_authorities: Arc::new(allowed_authorities),
        }
    }
}

pub(crate) fn router(state: Arc<MonitorState>) -> Router {
    Router::new()
        .route("/assets/monitor/{name}", get(asset))
        .route("/monitor/api/projects", get(projects).head(projects))
        .route(
            "/monitor/api/projects/{project_id}/board",
            get(board).head(board),
        )
        .route("/monitor/api/events", get(events))
        .route(
            "/monitor/api/projects/{project_id}/cards/{id}/attachments/{attachment_id}",
            get(card_attachment).head(card_attachment),
        )
        .route(
            "/monitor/api/projects/{project_id}/cards/{id}/evidence/{evidence_id}",
            get(card_evidence).head(card_evidence),
        )
        .route(
            "/monitor/api/projects/{project_id}/epics/{epic_id}",
            get(epic).head(epic),
        )
        .route(
            "/monitor/api/projects/{project_id}/epics/{epic_id}/attachments/{attachment_id}",
            get(epic_attachment).head(epic_attachment),
        )
        .route("/monitor/api/{*path}", any(not_found))
        .layer(middleware::from_fn_with_state(state.clone(), method_guard))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(middleware::from_fn(security_headers))
        .with_state(state)
}

async fn method_guard(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let monitor_answer = path.starts_with("/monitor/api/projects/")
        && path.ends_with("/answer")
        && matches!(*request.method(), Method::POST);
    if !path.starts_with("/monitor/api/")
        || monitor_answer
        || matches!(*request.method(), Method::GET | Method::HEAD)
    {
        next.run(request).await
    } else {
        StatusCode::METHOD_NOT_ALLOWED.into_response()
    }
}

async fn host_guard(
    State(state): State<Arc<MonitorState>>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !path.starts_with("/monitor") && !path.starts_with("/assets/monitor/") {
        return next.run(request).await;
    }
    let allowed = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| {
            state
                .allowed_authorities
                .contains(&host.to_ascii_lowercase())
        });
    if allowed {
        next.run(request).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let is_html = path == "/monitor/";
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    if is_html {
        headers.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
        headers.insert(header::CONTENT_SECURITY_POLICY, header::HeaderValue::from_static(
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ));
    } else if path.starts_with("/monitor/api/") {
        headers.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
    }
    response
}

async fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

async fn asset(Path(name): Path<String>) -> Response {
    match super::assets::monitor_lookup(&name) {
        Some((bytes, mime)) => (
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn projects(State(state): State<Arc<MonitorState>>) -> Response {
    match FileStore::open(&state.shared).catalog() {
        Ok(catalog) => api::json_response(StatusCode::OK, &catalog),
        Err(error) => api::agboard_error_response(&error),
    }
}

async fn board(
    State(state): State<Arc<MonitorState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match api::parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    match api::indexed_view_in(&state.shared, &state.index, &project_id) {
        Ok(view) => {
            #[derive(serde::Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Board<'a> {
                project: &'a crate::domain::ProjectMeta,
                version: &'a str,
                cursor: &'a crate::domain::ChangeCursor,
                epics: &'a [crate::file_store::model::EpicView],
                cards: Vec<&'a crate::file_store::model::CardView>,
                problems: &'a [crate::file_store::model::Problem],
            }
            let cards = view
                .cards
                .iter()
                .filter(|card| card.archived_at.is_none())
                .collect();
            api::json_response(
                StatusCode::OK,
                &Board {
                    project: &view.project,
                    version: &view.version,
                    cursor: &view.cursor,
                    epics: &view.epics,
                    cards,
                    problems: &view.problems,
                },
            )
        }
        Err(error) => api::agboard_error_response(&error),
    }
}

async fn card_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match api::parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let stored =
            store.attachment_path(&project_id, &AttachmentOwner::Card(id), &attachment_id)?;
        let bytes = api::read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => api::file_response(&mime, bytes),
        Ok(Err(error)) => api::agboard_error_response(&error),
        Err(error) => api::agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn card_evidence(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_id, evidence_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match api::parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::task::spawn_blocking(move || {
        FileStore::open(&state.shared).read_evidence(&project_id, id, &evidence_id)
    })
    .await;
    match result {
        Ok(Ok(data)) => api::file_response("text/plain; charset=utf-8", data.bytes),
        Ok(Err(error)) => api::agboard_error_response(&error),
        Err(error) => api::agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn epic(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
) -> Response {
    let project_id = match api::parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let epic_id = match raw_epic.parse::<EpicId>() {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let result = tokio::task::spawn_blocking(move || {
        FileStore::open(&state.shared).epic(&project_id, &epic_id)
    })
    .await;
    match result {
        Ok(Ok(epic)) => api::json_response(StatusCode::OK, &serde_json::json!({"epic": epic})),
        Ok(Err(error)) => api::agboard_error_response(&error),
        Err(error) => api::agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn epic_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_epic, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match api::parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let epic_id = match raw_epic.parse::<EpicId>() {
        Ok(id) => id,
        Err(error) => return api::agboard_error_response(&error),
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let owner = AttachmentOwner::Epic(epic_id);
        let stored = store.attachment_path(&project_id, &owner, &attachment_id)?;
        let bytes = api::read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => api::file_response(&mime, bytes),
        Ok(Err(error)) => api::agboard_error_response(&error),
        Err(error) => api::agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn events(
    State(state): State<Arc<MonitorState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    Sse::new(event_stream(state.changed.subscribe()).map(|event| Ok(event.into_sse())))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MonitorEvent {
    Ready,
    Changed,
    Heartbeat,
}

impl MonitorEvent {
    fn into_sse(self) -> Event {
        match self {
            Self::Ready => Event::default().event("ready").data("{}"),
            Self::Changed => Event::default().event("changed").data("{}"),
            Self::Heartbeat => Event::default().event("heartbeat").data("{}"),
        }
    }
}

fn event_stream(receiver: broadcast::Receiver<()>) -> impl Stream<Item = MonitorEvent> {
    let first_heartbeat = tokio::time::Instant::now() + Duration::from_secs(15);
    let changes = stream::unfold(
        (
            receiver,
            tokio::time::interval_at(first_heartbeat, Duration::from_secs(15)),
        ),
        |(mut rx, mut timer)| async move {
            tokio::select! {
                changed = rx.recv() => Some((match changed {
                    Ok(()) | Err(broadcast::error::RecvError::Lagged(_)) => MonitorEvent::Changed,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }, (rx, timer))),
                _ = timer.tick() => Some((MonitorEvent::Heartbeat, (rx, timer))),
            }
        },
    );
    stream::once(async { MonitorEvent::Ready }).chain(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn monitor_sse_sends_ready_then_a_fifteen_second_heartbeat() {
        let (changed, _) = broadcast::channel(4);
        let mut events = Box::pin(event_stream(changed.subscribe()));
        assert_eq!(events.next().await.unwrap(), MonitorEvent::Ready);
        tokio::time::advance(Duration::from_secs(14)).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(1), events.next())
                .await
                .is_err()
        );
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(events.next().await.unwrap(), MonitorEvent::Heartbeat);
    }
}
