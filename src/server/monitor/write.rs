//! The monitor's narrowly scoped write surface: answer a pending question,
//! and check or uncheck an acceptance condition.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use crate::server::AppState;
use crate::server::acceptance::{AcceptanceInput, set_project_task_acceptance};
use crate::server::answer::{AnswerInput, answer_project_task};
use crate::server::guard::{self, BoardWriteGuard};
use crate::server::monitor::assets;
use crate::server::request::ApiJson;
use crate::server::response::{forbidden, page_out_of_date};

#[derive(Clone)]
struct WriteState {
    app: Arc<AppState>,
    guard: BoardWriteGuard,
}

pub(crate) fn router(app: Arc<AppState>, guard: BoardWriteGuard) -> Router {
    let state = Arc::new(WriteState { app, guard });
    Router::new()
        .route("/monitor", get(redirect_monitor).head(redirect_monitor))
        .route("/monitor/", get(index).head(index))
        .route(
            "/monitor/api/projects/{project_id}/tasks/{id}/answer",
            axum::routing::post(answer),
        )
        .route(
            "/monitor/api/projects/{project_id}/tasks/{id}/acceptance/{condition}",
            axum::routing::put(acceptance),
        )
        .route(
            "/monitor/api/preferences",
            get(get_preferences).put(put_preferences),
        )
        .layer(middleware::from_fn_with_state(state.clone(), write_guard))
        .layer(middleware::from_fn_with_state(state.clone(), host_guard))
        .layer(middleware::from_fn(security_headers))
        .with_state(state)
}

async fn redirect_monitor() -> Response {
    (
        StatusCode::PERMANENT_REDIRECT,
        [(header::LOCATION, "/monitor/")],
    )
        .into_response()
}

async fn index(State(state): State<Arc<WriteState>>) -> Response {
    let html = assets::render_monitor(&state.guard.token);
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        html,
    )
        .into_response()
}

async fn answer(
    headers: HeaderMap,
    State(state): State<Arc<WriteState>>,
    Path((project_id, id)): Path<(String, String)>,
    ApiJson(input): ApiJson<AnswerInput>,
) -> Response {
    answer_project_task(headers, state.app.clone(), project_id, id, input).await
}

async fn acceptance(
    headers: HeaderMap,
    State(state): State<Arc<WriteState>>,
    Path(target): Path<(String, String, String)>,
    ApiJson(input): ApiJson<AcceptanceInput>,
) -> Response {
    set_project_task_acceptance(headers, state.app.clone(), target, input).await
}

/// The saved language and theme. Only the monitor's own preference write is
/// allowed here, and the entrance has already checked the session and CSRF.
async fn get_preferences(State(state): State<Arc<WriteState>>) -> Response {
    crate::server::preferences::http::read(&state.app.preferences)
}

async fn put_preferences(
    State(state): State<Arc<WriteState>>,
    ApiJson(body): ApiJson<serde_json::Value>,
) -> Response {
    crate::server::preferences::http::save(
        &state.app.preferences,
        &state.app.preferences_changed,
        body,
    )
}

async fn host_guard(
    State(state): State<Arc<WriteState>>,
    request: Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    if host.is_some_and(|host| state.guard.authorities.contains(&host.to_ascii_lowercase())) {
        next.run(request).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}

async fn write_guard(
    State(state): State<Arc<WriteState>>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path == "/monitor/api/preferences" {
        return match *request.method() {
            Method::GET | Method::HEAD => next.run(request).await,
            Method::PUT if guard::board_write_allowed(request.headers(), &state.guard) => {
                next.run(request).await
            }
            Method::PUT => forbidden("Changes can only be made from the current monitor page."),
            _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        };
    }
    let page_path = matches!(path, "/monitor" | "/monitor/");
    let answer_path = path.starts_with("/monitor/api/projects/") && path.ends_with("/answer");
    let acceptance_path = is_acceptance_path(path);
    if !page_path && !answer_path && !acceptance_path {
        return next.run(request).await;
    }
    if page_path && matches!(*request.method(), Method::GET | Method::HEAD) {
        return next.run(request).await;
    }
    // Each write has one method: POST to answer, PUT to set a condition.
    let write_method = if acceptance_path {
        Method::PUT
    } else {
        Method::POST
    };
    if (answer_path || acceptance_path)
        && *request.method() == write_method
        && guard::board_write_allowed(request.headers(), &state.guard)
    {
        return next.run(request).await;
    }
    if *request.method() != write_method {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if monitor_request_except_token_is_allowed(request.headers(), &state.guard) {
        page_out_of_date()
    } else {
        forbidden("Changes can only be made from the current monitor page.")
    }
}

fn monitor_request_except_token_is_allowed(headers: &HeaderMap, guard: &BoardWriteGuard) -> bool {
    if [
        "forwarded",
        "x-forwarded-host",
        "x-original-host",
        "x-http-method-override",
        "x-method-override",
    ]
    .iter()
    .any(|name| headers.contains_key(*name))
    {
        return false;
    }
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    let Some((origin, authority)) = origin.and_then(guard::canonical_https_origin) else {
        return false;
    };
    guard.origins.contains(&origin)
        && host
            .and_then(guard::canonical_https_authority)
            .is_some_and(|host| host == authority)
        && site == Some("same-origin")
}

async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
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
    if path == "/monitor/" {
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

#[cfg(test)]
mod tests;

/// `/monitor/api/projects/{project}/tasks/{id}/acceptance/{condition}`.
pub(crate) fn is_acceptance_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/monitor/api/projects/") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').collect();
    matches!(parts.as_slice(), [_, "tasks", _, "acceptance", condition] if !condition.is_empty())
}
