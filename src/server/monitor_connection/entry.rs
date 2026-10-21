//! The checks in front of the monitor, in the order they run:
//!
//! 1. the tunnel is up and the Host is exactly the public one;
//! 2. untrusted headers are removed;
//! 3. the bare origin forwards to `/monitor/`; a route that is not part of the
//!    monitor is a 404; the page and its assets need nothing more; `POST /monitor/api/unlock` trades the passcode
//!    for a session;
//! 4. every other API route needs a live session, and a change also needs the
//!    public Origin, same-origin fetch metadata and the CSRF token.
//!
//! Authentication always runs before a route is looked up. The Edge does no
//! sign-in and sets no header for the app to check: the public Host and the
//! passcode of the run are the whole of the entrance, and the passcode is the
//! only thing that opens a session.

mod reply;
mod session;

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use futures_util::StreamExt;

use self::reply::{forbidden, method_not_allowed, plain, session_required};
use self::session::{current_session, disconnect, open_session, unlock};
use super::router::{BackendPolicy, Gate, admit, refuse};
use crate::server::monitor::{apply_security_headers, assets};
use crate::server::monitor_auth::guard::{check_write, has_method_override, strip_untrusted};

const SESSION_PATH: &str = "/monitor/api/session";
const UNLOCK_PATH: &str = "/monitor/api/unlock";
const DISCONNECT_PATH: &str = "/monitor/api/disconnect";
const EVENTS_PATH: &str = "/monitor/api/events";
/// The header logo of the page. It is as public as the page's own assets and
/// passes the same entrance checks, but needs no session.
pub(super) const LOGO_PATH: &str = "/logo-white.png";
/// The longest one event stream is kept open; the page reconnects after it.
pub const EVENTS_MAX: Duration = Duration::from_secs(5 * 60);

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
        UNLOCK_PATH => return unlock(&policy, request).await,
        DISCONNECT_PATH => return disconnect(&policy, &request),
        "/" if matches!(*request.method(), Method::GET | Method::HEAD) => {
            return monitor_redirect();
        }
        "/monitor" | "/monitor/" => return page(&request),
        _ => {}
    }
    if path.starts_with("/monitor/assets/monitor/") || path == LOGO_PATH {
        return next.run(request).await;
    }
    if !path.starts_with("/monitor/api/") {
        return not_found().await;
    }

    let Some((secret, session)) = current_session(&policy, request.headers()) else {
        return session_required();
    };
    let changing = !matches!(*request.method(), Method::GET | Method::HEAD);
    if changing {
        if check_write(request.headers(), &policy.origin, &session).is_err() {
            return forbidden();
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

/// The monitor page. It holds no token, session or board data.
fn page(request: &Request) -> Response {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return method_not_allowed("GET, HEAD");
    }
    if request.uri().path() == "/monitor" {
        return monitor_redirect();
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

/// The page address without the slash, and the bare origin: both go to `/monitor/`.
/// The ngrok warning page ends on the bare origin after "Visit Site", so that
/// address has to forward too. Nothing here reveals anything.
fn monitor_redirect() -> Response {
    Response::builder()
        .status(StatusCode::PERMANENT_REDIRECT)
        .header(header::LOCATION, "/monitor/")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::empty())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    use futures_util::stream;

    use super::*;
    use crate::server::monitor_auth::contracts::SESSION_MAX_AGE_SECS;
    use crate::server::monitor_auth::passcode::{Passcode, UnlockGate};
    use crate::server::monitor_auth::session::SessionStore;
    use crate::server::monitor_connection::contracts::PublicOrigin;

    const ORIGIN: &str = "https://abc.ngrok.app";

    fn policy(now: &Arc<AtomicU64>, epoch: u64, origin: &str) -> BackendPolicy {
        let clock = now.clone();
        BackendPolicy::new(
            PublicOrigin::parse(origin).unwrap(),
            epoch,
            Arc::new(SessionStore::new(
                Arc::new(move || clock.load(Ordering::SeqCst)),
                SESSION_MAX_AGE_SECS,
            )),
            "internal".into(),
            Arc::new(UnlockGate::new(Passcode::from_number(1234))),
        )
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
