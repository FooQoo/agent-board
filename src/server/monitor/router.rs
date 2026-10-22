// file-size: allow (predates the 300-line limit; split it by responsibility rather than growing it)
//! The isolated read-only monitor router. Its state has no write service or token.

use std::collections::HashSet;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::{any, get};
use futures_util::stream::{self, Stream, StreamExt};
use tokio::sync::broadcast;

use super::data;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::index::ProjectIndex;
use crate::file_store::model::AttachmentOwner;
use crate::file_store::validate::EpicId;
use crate::server::preferences::{Preferences, PreferencesStore};
use crate::server::response::{agboard_error_response, file_response, json_response};
use crate::server::store::{indexed_view_in, parse_project_id, read_checked};
use crate::server::web_assets::{self, MONITOR_BUILD_ID};

#[derive(Clone)]
pub(crate) struct MonitorState {
    shared: PathBuf,
    index: Arc<RwLock<ProjectIndex>>,
    changed: broadcast::Sender<()>,
    preferences: PreferencesStore,
    preferences_changed: broadcast::Sender<Preferences>,
    allowed_authorities: Arc<HashSet<String>>,
}

impl MonitorState {
    pub(crate) fn new(
        shared: PathBuf,
        index: Arc<RwLock<ProjectIndex>>,
        changed: broadcast::Sender<()>,
        preferences: PreferencesStore,
        preferences_changed: broadcast::Sender<Preferences>,
        allowed_authorities: HashSet<String>,
    ) -> Self {
        Self {
            shared,
            index,
            changed,
            preferences,
            preferences_changed,
            allowed_authorities: Arc::new(allowed_authorities),
        }
    }
}

pub(crate) fn router(state: Arc<MonitorState>) -> Router {
    Router::new()
        .route("/monitor/assets/monitor/{name}", get(asset))
        .route("/monitor/api/projects", get(projects).head(projects))
        .route(
            "/monitor/api/projects/{project_id}/board",
            get(board).head(board),
        )
        .route(
            "/monitor/api/projects/{project_id}/summary",
            get(data::summary).head(data::summary),
        )
        .route(
            "/monitor/api/projects/{project_id}/tasks/{id}/detail",
            get(data::task_detail).head(data::task_detail),
        )
        .route(
            "/monitor/api/projects/{project_id}/epics/{epic_id}/detail",
            get(data::epic_detail).head(data::epic_detail),
        )
        .route("/monitor/api/events", get(events))
        .route(
            "/monitor/api/projects/{project_id}/tasks/{id}/attachments/{attachment_id}",
            get(task_attachment).head(task_attachment),
        )
        .route(
            "/monitor/api/projects/{project_id}/epics",
            get(epics).head(epics),
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
    if !path.starts_with("/monitor") && !path.starts_with("/monitor/assets/monitor/") {
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
    let mut response = next.run(request).await;
    apply_security_headers(&path, response.headers_mut());
    response
}

/// The headers every monitor response carries; the page and the API are never cached.
pub(crate) fn apply_security_headers(path: &str, headers: &mut HeaderMap) {
    let is_html = path == "/monitor/";
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
}

async fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

/// A content-named monitor file, cached for a year; any other name is a 404
/// that is not cached.
async fn asset(Path(name): Path<String>, headers: HeaderMap) -> Response {
    match super::assets::monitor_lookup(&name) {
        Some(asset) => web_assets::response(asset, &headers),
        None => ([(header::CACHE_CONTROL, "no-store")], StatusCode::NOT_FOUND).into_response(),
    }
}

async fn projects(State(state): State<Arc<MonitorState>>) -> Response {
    match FileStore::open(&state.shared).catalog() {
        Ok(catalog) => json_response(StatusCode::OK, &catalog),
        Err(error) => agboard_error_response(&error),
    }
}

async fn board(
    State(state): State<Arc<MonitorState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view_in(&state.shared, &state.index, &project_id) {
        Ok(view) => {
            #[derive(serde::Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Board<'a> {
                project: &'a crate::domain::ProjectMeta,
                version: &'a str,
                cursor: &'a crate::domain::ChangeCursor,
                epics: &'a [crate::file_store::model::EpicView],
                epic_task_counts: &'a std::collections::BTreeMap<
                    String,
                    crate::server::epic_counts::EpicTaskCounts,
                >,
                tasks: Vec<&'a crate::file_store::model::TaskView>,
                problems: &'a [crate::file_store::model::Problem],
            }
            let tasks = view
                .tasks
                .iter()
                .filter(|task| task.archived_at.is_none())
                .collect();
            let epic_task_counts =
                crate::server::epic_counts::task_counts_by_epic(&view.epics, &view.tasks);
            json_response(
                StatusCode::OK,
                &Board {
                    project: &view.project,
                    version: &view.version,
                    cursor: &view.cursor,
                    epics: &view.epics,
                    epic_task_counts: &epic_task_counts,
                    tasks,
                    problems: &view.problems,
                },
            )
        }
        Err(error) => agboard_error_response(&error),
    }
}

async fn task_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_id, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let Ok(id) = raw_id.parse::<i64>() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let stored =
            store.attachment_path(&project_id, &AttachmentOwner::Task(id), &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => file_response(&mime, bytes),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn epics(
    State(state): State<Arc<MonitorState>>,
    Path(raw_project): Path<String>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    match indexed_view_in(&state.shared, &state.index, &project_id) {
        Ok(view) => json_response(StatusCode::OK, &serde_json::json!({"epics": view.epics})),
        Err(error) => agboard_error_response(&error),
    }
}

async fn epic(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_epic)): Path<(String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match raw_epic.parse::<EpicId>() {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = tokio::task::spawn_blocking(move || {
        FileStore::open(&state.shared).epic(&project_id, &epic_id)
    })
    .await;
    match result {
        Ok(Ok(epic)) => json_response(StatusCode::OK, &serde_json::json!({"epic": epic})),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn epic_attachment(
    State(state): State<Arc<MonitorState>>,
    Path((raw_project, raw_epic, attachment_id)): Path<(String, String, String)>,
) -> Response {
    let project_id = match parse_project_id(&raw_project) {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let epic_id = match raw_epic.parse::<EpicId>() {
        Ok(id) => id,
        Err(error) => return agboard_error_response(&error),
    };
    let result = tokio::task::spawn_blocking(move || {
        let store = FileStore::open(&state.shared);
        let owner = AttachmentOwner::Epic(epic_id);
        let stored = store.attachment_path(&project_id, &owner, &attachment_id)?;
        let bytes = read_checked(&store, &stored.path)?;
        Ok::<_, AgboardError>((stored.metadata.media_type, bytes))
    })
    .await;
    match result {
        Ok(Ok((mime, bytes))) => file_response(&mime, bytes),
        Ok(Err(error)) => agboard_error_response(&error),
        Err(error) => agboard_error_response(&AgboardError::DatabaseError {
            reason: error.to_string(),
        }),
    }
}

async fn events(
    State(state): State<Arc<MonitorState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = event_stream(
        state.changed.subscribe(),
        state.preferences_changed.subscribe(),
        state.preferences.clone(),
    );
    Sse::new(stream.map(|event| Ok(event.into_sse())))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MonitorEvent {
    Ready,
    Changed,
    Preferences(Preferences),
    Heartbeat,
}

impl MonitorEvent {
    fn into_sse(self) -> Event {
        match self {
            Self::Ready => Event::default()
                .event("ready")
                .data(format!(r#"{{"build":"{MONITOR_BUILD_ID}"}}"#)),
            Self::Changed => Event::default().event("changed").data("{}"),
            Self::Preferences(prefs) => Event::default()
                .event("preferences")
                .data(serde_json::to_string(&prefs).unwrap_or_else(|_| "{}".to_string())),
            Self::Heartbeat => Event::default().event("heartbeat").data("{}"),
        }
    }
}

fn event_stream(
    receiver: broadcast::Receiver<()>,
    saved: broadcast::Receiver<Preferences>,
    store: PreferencesStore,
) -> impl Stream<Item = MonitorEvent> {
    let first_heartbeat = tokio::time::Instant::now() + Duration::from_secs(15);
    let changes = stream::unfold(
        (
            receiver,
            saved,
            store,
            tokio::time::interval_at(first_heartbeat, Duration::from_secs(15)),
        ),
        |(mut rx, mut saved, store, mut timer)| async move {
            tokio::select! {
                changed = rx.recv() => Some((match changed {
                    Ok(()) | Err(broadcast::error::RecvError::Lagged(_)) => MonitorEvent::Changed,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }, (rx, saved, store, timer))),
                prefs = saved.recv() => Some((match prefs {
                    Ok(prefs) => MonitorEvent::Preferences(prefs),
                    // A lagged notice is replaced by the value that is saved now.
                    Err(broadcast::error::RecvError::Lagged(_)) => MonitorEvent::Preferences(store.load()),
                    Err(broadcast::error::RecvError::Closed) => return None,
                }, (rx, saved, store, timer))),
                _ = timer.tick() => Some((MonitorEvent::Heartbeat, (rx, saved, store, timer))),
            }
        },
    );
    stream::once(async { MonitorEvent::Ready }).chain(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_saved_preference_is_sent_as_a_preferences_event_not_changed() {
        use crate::server::preferences::Theme;
        let (changed, _) = broadcast::channel(4);
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let mut events = Box::pin(event_stream(changed.subscribe(), saved.subscribe(), store));
        assert_eq!(events.next().await, Some(MonitorEvent::Ready));
        let prefs = Preferences {
            locale: "ja".to_string(),
            theme: Theme {
                mode: "dark".to_string(),
                accent: "teal".to_string(),
            },
            revision: 1,
        };
        saved.send(prefs.clone()).unwrap();
        assert_eq!(events.next().await, Some(MonitorEvent::Preferences(prefs)));
    }

    #[tokio::test(start_paused = true)]
    async fn monitor_sse_sends_ready_then_a_fifteen_second_heartbeat() {
        let (changed, _) = broadcast::channel(4);
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let mut events = Box::pin(event_stream(changed.subscribe(), saved.subscribe(), store));
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
