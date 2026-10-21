//! The checks in front of the monitor, in the order they run:
//!
//! 1. the tunnel is up, the Host is the public one and exactly one proof matches
//!    (so the request came through the Edge, which has already done Google
//!    sign-in and the allow list);
//! 2. untrusted headers are removed;
//! 3. a route that is not part of the monitor is a 404; the page and its
//!    assets need nothing more; `GET /monitor/api/session` starts a session;
//! 4. every other API route needs a live session, and a change also needs the
//!    public Origin, same-origin fetch metadata and the CSRF token.
//!
//! Authentication always runs before a route is looked up.

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use futures_util::StreamExt;

use super::router::{BackendPolicy, Gate, admit, refuse};
use crate::server::monitor::{apply_security_headers, assets};
use crate::server::monitor_auth::contracts::{
    AuthSession, SESSION_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME,
};
use crate::server::monitor_auth::guard::{
    check_write, has_method_override, session_cookie, strip_untrusted,
};

const SESSION_PATH: &str = "/monitor/api/session";
const DISCONNECT_PATH: &str = "/monitor/api/disconnect";
const EVENTS_PATH: &str = "/monitor/api/events";
/// The longest one event stream is kept open; the page reconnects after it.
pub const EVENTS_MAX: Duration = Duration::from_secs(5 * 60);
/// Where the Edge ends its own sign-in. The page goes there after `disconnect`.
const EDGE_LOGOUT_PATH: &str = "/ngrok/logout";

pub(super) fn external_router(gate: Gate, inner: Router) -> Router {
    inner
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(gate, entry))
}

async fn not_found() -> Response {
    plain(StatusCode::NOT_FOUND, "not_found", "not found.")
}

async fn entry(State(gate): State<Gate>, mut request: Request, next: Next) -> Response {
    let policy = gate.read().unwrap_or_else(|e| e.into_inner()).clone();
    if admit(policy.as_ref(), request.headers()).is_err() {
        return refuse();
    }
    let Some(policy) = policy else {
        return refuse();
    };
    if has_method_override(request.headers()) {
        return refuse();
    }
    strip_untrusted(request.headers_mut());
    let path = request.uri().path().to_owned();
    match path.as_str() {
        SESSION_PATH => return open_session(&policy, request.method(), request.headers()),
        DISCONNECT_PATH => return disconnect(&policy, &request),
        "/monitor" | "/monitor/" => return page(&request),
        _ => {}
    }
    if path.starts_with("/assets/monitor/") {
        return next.run(request).await;
    }
    if !path.starts_with("/monitor/api/") {
        return not_found().await;
    }

    let Some((secret, session)) = current_session(&policy, request.headers()) else {
        return plain(
            StatusCode::UNAUTHORIZED,
            "session_required",
            "sign in again.",
        );
    };
    let changing = !matches!(*request.method(), Method::GET | Method::HEAD);
    if changing {
        if check_write(request.headers(), &policy.origin, &session).is_err() {
            return plain(
                StatusCode::FORBIDDEN,
                "forbidden",
                "request is not allowed.",
            );
        }
        // Only the existing write guard sees this; the page never has it.
        if let Ok(value) = HeaderValue::from_str(&policy.internal_token) {
            request
                .headers_mut()
                .insert(HeaderName::from_static("x-agboard-token"), value);
        }
    }
    request.headers_mut().remove(header::COOKIE);
    let response = next.run(request).await;
    if path == EVENTS_PATH && response.status() == StatusCode::OK {
        return bound_events(response, &policy, secret, session.expires_at);
    }
    response
}

fn current_session(policy: &BackendPolicy, headers: &HeaderMap) -> Option<(String, AuthSession)> {
    let secret = session_cookie(headers)?;
    let session = policy
        .sessions
        .check(&secret, policy.epoch, policy.origin.origin())
        .ok()?;
    Some((secret, session))
}

/// `GET /monitor/api/session`: a page that came through the Edge asks for its
/// session. A live one is kept (so tabs share it); otherwise a new one starts.
fn open_session(policy: &BackendPolicy, method: &Method, headers: &HeaderMap) -> Response {
    if *method != Method::GET {
        return method_not_allowed("GET");
    }
    let cross_site = headers
        .get_all("sec-fetch-site")
        .iter()
        .any(|v| v.as_bytes() != b"same-origin");
    if cross_site {
        return plain(
            StatusCode::FORBIDDEN,
            "forbidden",
            "request is not allowed.",
        );
    }
    let (secret, csrf, expires_at, is_new) = match current_session(policy, headers) {
        Some((secret, session)) => (
            secret.clone(),
            crate::server::monitor_auth::session::csrf_for(&secret),
            session.expires_at,
            false,
        ),
        None => match policy.sessions.issue(policy.origin.origin(), policy.epoch) {
            Ok(issued) => (issued.secret, issued.csrf, issued.expires_at, true),
            Err(_) => {
                return plain(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "could not start a session.",
                );
            }
        },
    };
    let now = policy.sessions.now();
    let body = serde_json::json!({
        "csrfToken": csrf,
        "expiresAt": expires_at,
        "expiresInSeconds": expires_at.saturating_sub(now),
    });
    let mut response = json(StatusCode::OK, &body);
    if is_new {
        let cookie = format!(
            "{SESSION_COOKIE_NAME}={secret}; {SESSION_COOKIE_ATTRIBUTES}; Max-Age={}",
            expires_at.saturating_sub(now)
        );
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
    }
    response
}

/// `POST /monitor/api/disconnect`: forget the session, then the page goes to
/// the Edge's logout.
fn disconnect(policy: &BackendPolicy, request: &Request) -> Response {
    if *request.method() != Method::POST {
        return method_not_allowed("POST");
    }
    let Some((secret, session)) = current_session(policy, request.headers()) else {
        return plain(
            StatusCode::UNAUTHORIZED,
            "session_required",
            "sign in again.",
        );
    };
    if check_write(request.headers(), &policy.origin, &session).is_err() {
        return plain(
            StatusCode::FORBIDDEN,
            "forbidden",
            "request is not allowed.",
        );
    }
    policy.sessions.revoke(&secret);
    let mut response = json(
        StatusCode::OK,
        &serde_json::json!({"disconnected": true, "logoutPath": EDGE_LOGOUT_PATH}),
    );
    let cleared = format!("{SESSION_COOKIE_NAME}=; {SESSION_COOKIE_ATTRIBUTES}; Max-Age=0");
    if let Ok(value) = HeaderValue::from_str(&cleared) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// The monitor page. It holds no token, session or board data.
fn page(request: &Request) -> Response {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return method_not_allowed("GET, HEAD");
    }
    if request.uri().path() == "/monitor" {
        return Response::builder()
            .status(StatusCode::PERMANENT_REDIRECT)
            .header(header::LOCATION, "/monitor/")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::empty())
            .unwrap_or_default();
    }
    let mut response = Response::new(Body::from(assets::render_monitor("")));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    apply_security_headers("/monitor/", headers);
    response
}

/// Keep an event stream no longer than [`EVENTS_MAX`], the session, or the run.
fn bound_events(
    response: Response,
    policy: &BackendPolicy,
    secret: String,
    expires_at: u64,
) -> Response {
    let (parts, body) = response.into_parts();
    let remaining = expires_at.saturating_sub(policy.sessions.now());
    let limit = EVENTS_MAX.min(Duration::from_secs(remaining));
    let mut revoked = policy.revocation();
    let stop = async move {
        tokio::select! {
            () = tokio::time::sleep(limit) => {}
            _ = revoked.wait_for(|closed| *closed) => {}
        }
    };
    let (sessions, epoch, origin) = (
        policy.sessions.clone(),
        policy.epoch,
        policy.origin.origin().to_string(),
    );
    let stream = body
        .into_data_stream()
        .take_until(stop)
        .take_while(move |_| std::future::ready(sessions.check(&secret, epoch, &origin).is_ok()));
    Response::from_parts(parts, Body::from_stream(stream))
}

fn json(status: StatusCode, value: &serde_json::Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(value.to_string()))
        .unwrap_or_default()
}

fn plain(status: StatusCode, code: &str, message: &str) -> Response {
    json(
        status,
        &serde_json::json!({"error": {"code": code, "message": message}}),
    )
}

fn method_not_allowed(allow: &'static str) -> Response {
    let mut response = plain(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "method not allowed.",
    );
    response
        .headers_mut()
        .insert(header::ALLOW, HeaderValue::from_static(allow));
    response
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    use futures_util::stream;

    use super::*;
    use crate::server::monitor_auth::contracts::SESSION_MAX_AGE_SECS;
    use crate::server::monitor_auth::session::SessionStore;
    use crate::server::monitor_connection::contracts::{PublicOrigin, TunnelProof};

    const ORIGIN: &str = "https://abc.ngrok.app";

    fn policy(now: &Arc<AtomicU64>, epoch: u64, origin: &str) -> BackendPolicy {
        let clock = now.clone();
        BackendPolicy::new(
            TunnelProof::from_bytes(&[1u8; 32]),
            PublicOrigin::parse(origin).unwrap(),
            epoch,
            Arc::new(SessionStore::new(
                Arc::new(move || clock.load(Ordering::SeqCst)),
                SESSION_MAX_AGE_SECS,
            )),
            "internal".into(),
        )
    }

    fn cookie_of(response: &Response) -> HeaderMap {
        let set = response.headers().get(header::SET_COOKIE).unwrap();
        let pair = set.to_str().unwrap().split(';').next().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(pair).unwrap());
        headers
    }

    #[test]
    fn a_session_ends_after_twelve_hours_and_never_crosses_a_generation_or_origin() {
        let now = Arc::new(AtomicU64::new(10_000));
        let p = policy(&now, 3, ORIGIN);
        let issued = open_session(&p, &Method::GET, &HeaderMap::new());
        assert_eq!(issued.status(), StatusCode::OK);
        let cookie = cookie_of(&issued);
        assert!(current_session(&p, &cookie).is_some());

        // The same store under a later generation, or another public origin.
        let mut later = p.clone();
        later.epoch = 4;
        assert!(current_session(&later, &cookie).is_none());
        let mut moved = p.clone();
        moved.origin = PublicOrigin::parse("https://other.ngrok.app").unwrap();
        assert!(current_session(&moved, &cookie).is_none());

        now.store(10_000 + SESSION_MAX_AGE_SECS - 1, Ordering::SeqCst);
        assert!(current_session(&p, &cookie).is_some());
        now.store(10_000 + SESSION_MAX_AGE_SECS, Ordering::SeqCst);
        assert!(current_session(&p, &cookie).is_none());
        // Asking again with the dead cookie starts a fresh session.
        let fresh = open_session(&p, &Method::GET, &cookie);
        assert!(fresh.headers().contains_key(header::SET_COOKIE));
        assert!(current_session(&p, &cookie_of(&fresh)).is_some());
    }

    fn endless() -> Response {
        let ticks = stream::unfold(0u32, |n| async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            Some((Ok::<_, std::io::Error>(format!("{n}\n")), n + 1))
        });
        Response::new(Body::from_stream(ticks))
    }

    async fn run_until_end(response: Response) -> (usize, tokio::time::Duration) {
        let started = tokio::time::Instant::now();
        let chunks = response.into_body().into_data_stream().count().await;
        (chunks, started.elapsed())
    }

    #[tokio::test(start_paused = true)]
    async fn an_event_stream_lasts_five_minutes_at_most() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        let issued = p.sessions.issue(ORIGIN, 1).unwrap();
        let response = bound_events(endless(), &p, issued.secret, issued.expires_at);
        let (_, took) = run_until_end(response).await;
        assert_eq!(took, EVENTS_MAX);
    }

    #[tokio::test(start_paused = true)]
    async fn an_event_stream_never_outlives_its_session() {
        let now = Arc::new(AtomicU64::new(1_000));
        let p = policy(&now, 1, ORIGIN);
        let issued = p.sessions.issue(ORIGIN, 1).unwrap();
        // 30 seconds of life left.
        now.store(1_000 + SESSION_MAX_AGE_SECS - 30, Ordering::SeqCst);
        let response = bound_events(endless(), &p, issued.secret, issued.expires_at);
        let (_, took) = run_until_end(response).await;
        assert_eq!(took, Duration::from_secs(30));
    }

    #[tokio::test(start_paused = true)]
    async fn closing_the_run_ends_open_streams_and_a_revoked_session_ends_at_the_next_event() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        let issued = p.sessions.issue(ORIGIN, 1).unwrap();
        let response = bound_events(endless(), &p, issued.secret.clone(), issued.expires_at);
        let closer = p.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(3500)).await;
            closer.revoke();
        });
        let (chunks, took) = run_until_end(response).await;
        assert_eq!(chunks, 3);
        assert_eq!(took, Duration::from_millis(3500));

        let p = policy(&now, 1, ORIGIN);
        let issued = p.sessions.issue(ORIGIN, 1).unwrap();
        let response = bound_events(endless(), &p, issued.secret.clone(), issued.expires_at);
        let sessions = p.sessions.clone();
        let secret = issued.secret;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(2500)).await;
            sessions.revoke(&secret);
        });
        let (chunks, _) = run_until_end(response).await;
        // The first two events were sent; the third finds the session gone.
        assert_eq!(chunks, 2);
    }
}
