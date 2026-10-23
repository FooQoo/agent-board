// file-size: allow (predates the 300-line limit; split it by responsibility rather than growing it)
//! The isolated read-only monitor router. Its state has no write service or token.

use std::collections::HashSet;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path, RawQuery, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::{any, get};
use futures_util::stream::{self, Stream, StreamExt};
use tokio::sync::broadcast;

use super::data;
use crate::domain::ProjectId;
use crate::error::AgboardError;
use crate::file_store::FileStore;
use crate::file_store::index::ProjectIndex;
use crate::file_store::model::AttachmentOwner;
use crate::file_store::validate::EpicId;
use crate::server::change_feed::{ChangeEvent, ChangeFeed};
use crate::server::preferences::{Preferences, PreferencesStore};
use crate::server::response::{agboard_error_response, file_response};
use crate::server::store::{parse_project_id, read_checked};
use crate::server::web_assets::{self, MONITOR_BUILD_ID};

#[derive(Clone)]
pub(crate) struct MonitorState {
    shared: PathBuf,
    index: Arc<RwLock<ProjectIndex>>,
    changed: ChangeFeed,
    preferences: PreferencesStore,
    preferences_changed: broadcast::Sender<Preferences>,
    allowed_authorities: Arc<HashSet<String>>,
}

impl MonitorState {
    pub(crate) fn new(
        shared: PathBuf,
        index: Arc<RwLock<ProjectIndex>>,
        changed: ChangeFeed,
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

impl MonitorState {
    pub(super) fn shared(&self) -> &std::path::Path {
        &self.shared
    }

    pub(super) fn index(&self) -> &RwLock<ProjectIndex> {
        &self.index
    }
}

pub(crate) fn router(state: Arc<MonitorState>) -> Router {
    Router::new()
        .route("/monitor/assets/monitor/{name}", get(asset))
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

/// The project a monitor stream follows: `?project=<id>`. A missing or malformed ID is
/// `invalid_value` and an ID that names no project is `project_not_found`.
fn stream_project(state: &MonitorState, query: Option<&str>) -> Result<ProjectId, AgboardError> {
    let raw = query.and_then(|query| {
        query.split('&').find_map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (name == "project").then_some(value)
        })
    });
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Err(AgboardError::InvalidValue {
            field: "project".into(),
            reason: "The events stream needs ?project=<project ID>.".into(),
        });
    };
    let id = parse_project_id(raw)?;
    let known = state
        .index
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .entry(&id)
        .is_some();
    if known {
        Ok(id)
    } else {
        Err(AgboardError::ProjectNotFound {
            project: id.to_string(),
        })
    }
}

async fn events(State(state): State<Arc<MonitorState>>, RawQuery(query): RawQuery) -> Response {
    let project = match stream_project(&state, query.as_deref()) {
        Ok(project) => project,
        Err(error) => return agboard_error_response(&error),
    };
    let stream = event_stream(
        state.changed.clone(),
        project,
        state.preferences_changed.subscribe(),
        state.preferences.clone(),
    );
    Sse::new(stream.map(|event| Ok::<_, Infallible>(event.into_sse()))).into_response()
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MonitorEvent {
    Ready,
    /// The JSON of a `changed` event.
    Changed(String),
    /// The JSON of a `resync` event.
    Resync(String),
    Preferences(Preferences),
    Heartbeat,
}

impl MonitorEvent {
    fn into_sse(self) -> Event {
        match self {
            Self::Ready => Event::default()
                .event("ready")
                .data(format!(r#"{{"build":"{MONITOR_BUILD_ID}"}}"#)),
            Self::Changed(data) => Event::default().event("changed").data(data),
            Self::Resync(data) => Event::default().event("resync").data(data),
            Self::Preferences(prefs) => Event::default()
                .event("preferences")
                .data(serde_json::to_string(&prefs).unwrap_or_else(|_| "{}".to_string())),
            Self::Heartbeat => Event::default().event("heartbeat").data("{}"),
        }
    }
}

/// The `changed` JSON of a stream that follows one project, or `None` for an event that is not
/// for it. The project list changes (`project` resources) are not sent. The numbers are counted
/// on this stream, so the events of other projects leave no gap; a stream that fell behind gets
/// `resync` instead.
fn project_changed(
    feed: &ChangeFeed,
    project: &ProjectId,
    event: &ChangeEvent,
    seq: u64,
) -> Option<String> {
    if &event.set.project_id != project {
        return None;
    }
    let mut changed = feed.changed(event);
    changed
        .changes
        .retain(|change| change.resource != crate::server::contracts::ChangeResource::Project);
    if changed.changes.is_empty() {
        return None;
    }
    changed.seq = seq;
    serde_json::to_string(&changed).ok()
}

fn event_stream(
    feed: ChangeFeed,
    project: ProjectId,
    saved: broadcast::Receiver<Preferences>,
    store: PreferencesStore,
) -> impl Stream<Item = MonitorEvent> {
    let first_heartbeat = tokio::time::Instant::now() + Duration::from_secs(15);
    let receiver = feed.subscribe();
    let changes = stream::unfold(
        (
            receiver,
            saved,
            store,
            tokio::time::interval_at(first_heartbeat, Duration::from_secs(15)),
            0u64,
        ),
        move |(mut rx, mut saved, store, mut timer, mut seq)| {
            let feed = feed.clone();
            let project = project.clone();
            async move {
                loop {
                    tokio::select! {
                        changed = rx.recv() => match changed {
                            Ok(event) => {
                                if let Some(data) = project_changed(&feed, &project, &event, seq + 1) {
                                    seq += 1;
                                    return Some((MonitorEvent::Changed(data), (rx, saved, store, timer, seq)));
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                let data = serde_json::json!({"instanceId": feed.instance_id(), "seq": seq}).to_string();
                                return Some((MonitorEvent::Resync(data), (rx, saved, store, timer, seq)));
                            }
                            Err(broadcast::error::RecvError::Closed) => return None,
                        },
                        prefs = saved.recv() => return Some((match prefs {
                            Ok(prefs) => MonitorEvent::Preferences(prefs),
                            // A lagged notice is replaced by the value that is saved now.
                            Err(broadcast::error::RecvError::Lagged(_)) => MonitorEvent::Preferences(store.load()),
                            Err(broadcast::error::RecvError::Closed) => return None,
                        }, (rx, saved, store, timer, seq))),
                        _ = timer.tick() => return Some((MonitorEvent::Heartbeat, (rx, saved, store, timer, seq))),
                    }
                }
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
        let changed = ChangeFeed::new();
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let project: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        let mut events = Box::pin(event_stream(changed, project, saved.subscribe(), store));
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
        let changed = ChangeFeed::new();
        let (saved, _) = broadcast::channel(4);
        let store = PreferencesStore::new(std::path::Path::new("."));
        let project: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
        let mut events = Box::pin(event_stream(changed, project, saved.subscribe(), store));
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
