//! The isolated read-only monitor router. Its state has no write service or token.

mod attachments;
mod events;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use tokio::sync::broadcast;

use super::data;
use crate::file_store::index::ProjectIndex;
use crate::server::change_feed::ChangeFeed;
use crate::server::preferences::{Preferences, PreferencesStore};
use crate::server::web_assets;

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
        .route("/monitor/api/events", get(events::events))
        .route(
            "/monitor/api/projects/{project_id}/tasks/{id}/attachments/{attachment_id}",
            get(attachments::task_attachment).head(attachments::task_attachment),
        )
        .route(
            "/monitor/api/projects/{project_id}/epics/{epic_id}/attachments/{attachment_id}",
            get(attachments::epic_attachment).head(attachments::epic_attachment),
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
    let monitor_acceptance =
        super::write::is_acceptance_path(path) && matches!(*request.method(), Method::PUT);
    if !path.starts_with("/monitor/api/")
        || monitor_answer
        || monitor_acceptance
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
