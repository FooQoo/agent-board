//! The checks in front of the board, in the order they run:
//!
//! 1. the tunnel is up and the Host is exactly the public one;
//! 2. untrusted headers are removed;
//! 3. the passcode and session routes (`/api/remote/unlock`, `/api/remote/session`) are answered
//!    here; the page shell and its static files need nothing more;
//! 4. every other route needs a live session, and a change also needs the public Origin,
//!    same-origin fetch metadata and the CSRF token.
//!
//! Authentication always runs before a route is looked up. The Edge does no
//! sign-in and sets no header for the app to check: the public Host and the
//! passcode of the run are the whole of the entrance, and the passcode is the
//! only thing that opens a session. No board token is ever sent through here.

mod reply;
mod session;

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use futures_util::StreamExt;

use self::reply::{forbidden, plain, session_required};
use self::session::{current_session, open_session, unlock};
use super::router::{BackendPolicy, Gate, admit, refuse};
use crate::server::monitor_auth::guard::{check_write, has_method_override, strip_untrusted};

/// Where the board app asks for its session and enters the passcode.
const REMOTE_SESSION_PATH: &str = "/api/remote/session";
const REMOTE_UNLOCK_PATH: &str = "/api/remote/unlock";
const EVENTS_PATH: &str = "/api/events";

/// The page shell and its static files: they hold no token and no board data, so they need the
/// entrance checks but no session. Everything else is behind the session.
fn is_public(method: &Method, path: &str) -> bool {
    if !matches!(*method, Method::GET | Method::HEAD) {
        return false;
    }
    matches!(
        path,
        "/" | "/logo.png" | "/logo-white.png" | "/docs-sandbox"
    ) || path.starts_with("/assets/")
        || path.starts_with("/docs-sandbox/")
}
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
    // The old mobile monitor's addresses are gone: they are not found, session or none.
    if path == "/monitor" || path.starts_with("/monitor/") {
        return not_found().await;
    }
    match path.as_str() {
        REMOTE_SESSION_PATH => {
            return open_session(&policy, request.method(), request.headers());
        }
        REMOTE_UNLOCK_PATH => return unlock(&policy, request).await,
        _ => {}
    }
    if is_public(request.method(), &path) {
        return with_nosniff(next.run(request).await);
    }

    let Some((secret, session)) = current_session(&policy, request.headers()) else {
        return session_required();
    };
    let changing = !matches!(*request.method(), Method::GET | Method::HEAD);
    if changing && check_write(request.headers(), &policy.origin, &session).is_err() {
        return forbidden();
    }
    request.headers_mut().remove(header::COOKIE);
    let response = next.run(request).await;
    if path == EVENTS_PATH && response.status() == StatusCode::OK {
        return bound_events(response, &policy, secret, session.expires_at);
    }
    response
}

fn with_nosniff(mut response: Response) -> Response {
    response
        .headers_mut()
        .entry(header::X_CONTENT_TYPE_OPTIONS)
        .or_insert(HeaderValue::from_static("nosniff"));
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
