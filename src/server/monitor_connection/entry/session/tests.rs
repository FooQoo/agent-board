mod unlock;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::body::Body;
use axum::http::HeaderName;

use super::*;
use crate::server::monitor_auth::contracts::SESSION_MAX_AGE_SECS;
use crate::server::monitor_auth::passcode::{MAX_FAILURES, Passcode, UnlockGate};
use crate::server::monitor_auth::session::SessionStore;
use crate::server::monitor_connection::contracts::PublicOrigin;

const ORIGIN: &str = "https://abc.ngrok.app";
const CODE: &str = "4821";

fn policy(now: &Arc<AtomicU64>, epoch: u64, origin: &str) -> BackendPolicy {
    let clock = now.clone();
    BackendPolicy::new(
        PublicOrigin::parse(origin).unwrap(),
        epoch,
        Arc::new(SessionStore::new(
            Arc::new(move || clock.load(Ordering::SeqCst)),
            SESSION_MAX_AGE_SECS,
        )),
        Arc::new(UnlockGate::new(Passcode::from_number(4821))),
    )
}

fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut h = HeaderMap::new();
    for (k, v) in pairs {
        h.append(
            HeaderName::from_bytes(k.as_bytes()).unwrap(),
            HeaderValue::from_str(v).unwrap(),
        );
    }
    h
}

const PAGE: [(&str, &str); 3] = [
    ("origin", ORIGIN),
    ("sec-fetch-site", "same-origin"),
    ("content-type", "application/json"),
];

fn post(path: &str, pairs: &[(&str, &str)], body: &str) -> Request {
    let mut builder = Request::builder().method(Method::POST).uri(path);
    for (k, v) in pairs {
        builder = builder.header(*k, *v);
    }
    builder.body(Body::from(body.to_owned())).unwrap()
}

async fn try_code(p: &BackendPolicy, code: &str) -> Response {
    unlock(p, post(UNLOCK, &PAGE, &format!(r#"{{"code":"{code}"}}"#))).await
}

const UNLOCK: &str = "/api/remote/unlock";

async fn body_of(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn cookie_of(response: &Response) -> HeaderMap {
    let set = response.headers().get(header::SET_COOKIE).unwrap();
    let pair = set.to_str().unwrap().split(';').next().unwrap();
    headers(&[("cookie", pair)])
}

#[tokio::test]
async fn only_the_passcode_starts_a_session_and_only_get_session_shows_it() {
    let now = Arc::new(AtomicU64::new(10_000));
    let p = policy(&now, 3, ORIGIN);

    // Asking for a session without a cookie gives nothing, and sets nothing.
    let none = open_session(&p, &Method::GET, &HeaderMap::new());
    assert_eq!(none.status(), StatusCode::UNAUTHORIZED);
    assert!(!none.headers().contains_key(header::SET_COOKIE));
    assert_eq!(body_of(none).await["error"]["code"], "session_required");
    let stale = headers(&[("cookie", "agboard_ngrok_session=guess")]);
    assert_eq!(
        open_session(&p, &Method::GET, &stale).status(),
        StatusCode::UNAUTHORIZED
    );

    // The passcode starts one, with the scoped cookie.
    let issued = try_code(&p, CODE).await;
    assert_eq!(issued.status(), StatusCode::OK);
    let set = issued
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    for part in [
        "agboard_ngrok_session=",
        "; Secure",
        "; HttpOnly",
        "; SameSite=Lax",
        "; Path=/;",
        "; Max-Age=43200",
    ] {
        assert!(set.contains(part), "{part} in {set}");
    }
    let cookie = cookie_of(&issued);
    let started = body_of(issued).await;
    assert_eq!(started["csrfToken"].as_str().unwrap().len(), 64);
    assert_eq!(started["expiresInSeconds"], SESSION_MAX_AGE_SECS);

    // A page that asks again with its cookie keeps the session and its token.
    let again = open_session(&p, &Method::GET, &cookie);
    assert_eq!(again.status(), StatusCode::OK);
    assert!(!again.headers().contains_key(header::SET_COOKIE));
    assert_eq!(body_of(again).await["csrfToken"], started["csrfToken"]);

    // Only GET, and not from another site.
    assert_eq!(
        open_session(&p, &Method::HEAD, &cookie).status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    let cross = headers(&[("cookie", "x=y"), ("sec-fetch-site", "cross-site")]);
    assert_eq!(
        open_session(&p, &Method::GET, &cross).status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn a_session_ends_after_twelve_hours_and_never_crosses_a_generation_or_origin() {
    let now = Arc::new(AtomicU64::new(10_000));
    let p = policy(&now, 3, ORIGIN);
    let cookie = cookie_of(&try_code(&p, CODE).await);
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
    // The dead cookie is not renewed: the passcode is asked for again.
    assert_eq!(
        open_session(&p, &Method::GET, &cookie).status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
}

#[test]
fn a_session_for_a_device_removed_in_the_meantime_is_not_kept() {
    let now = Arc::new(AtomicU64::new(10_000));
    let p = policy(&now, 1, ORIGIN);
    let registered = p.devices.register(ORIGIN, None).unwrap();
    // The device was checked, then removed before its session was issued.
    assert!(p.devices.remove(&registered.id).unwrap());
    assert!(session_response(&p, Some(registered.id)).is_none());
    assert!(p.sessions.is_empty());

    // A registered device and a session with no device still get theirs.
    let kept = p.devices.register(ORIGIN, None).unwrap();
    assert!(session_response(&p, Some(kept.id)).is_some());
    assert!(session_response(&p, None).is_some());
}
