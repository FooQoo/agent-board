//! The routes that show, begin and end a session.
//!
//! A session starts only at `POST /monitor/api/unlock`, with the passcode of
//! this start. `GET /monitor/api/session` shows the session a cookie already
//! has and starts nothing.

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::Response;
use serde::Deserialize;

use super::reply::{forbidden, json, method_not_allowed, plain, session_required};
use crate::server::monitor_auth::contracts::{
    AuthSession, SESSION_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME,
};
use crate::server::monitor_auth::guard::{check_same_origin, check_write, is_json, session_cookie};
use crate::server::monitor_auth::passcode::Unlock;
use crate::server::monitor_auth::session::csrf_for;
use crate::server::monitor_connection::router::BackendPolicy;

/// A passcode is four digits; nothing bigger than this is a real attempt.
const MAX_UNLOCK_BODY: usize = 256;

pub(super) fn current_session(
    policy: &BackendPolicy,
    headers: &HeaderMap,
) -> Option<(String, AuthSession)> {
    let secret = session_cookie(headers)?;
    let session = policy
        .sessions
        .check(&secret, policy.epoch, policy.origin.origin())
        .ok()?;
    Some((secret, session))
}

/// What the page needs to use a session: the CSRF token and how long is left.
fn session_body(policy: &BackendPolicy, csrf: &str, expires_at: u64) -> serde_json::Value {
    serde_json::json!({
        "csrfToken": csrf,
        "expiresAt": expires_at,
        "expiresInSeconds": expires_at.saturating_sub(policy.sessions.now()),
    })
}

/// `GET /monitor/api/session`: the page asks whether it has a live session. With
/// one it gets the session's CSRF token; without one it is told to enter the
/// passcode. Nothing is issued here.
pub(super) fn open_session(
    policy: &BackendPolicy,
    method: &Method,
    headers: &HeaderMap,
) -> Response {
    if *method != Method::GET {
        return method_not_allowed("GET");
    }
    let cross_site = headers
        .get_all("sec-fetch-site")
        .iter()
        .any(|v| v.as_bytes() != b"same-origin");
    if cross_site {
        return forbidden();
    }
    match current_session(policy, headers) {
        Some((secret, session)) => json(
            StatusCode::OK,
            &session_body(policy, &csrf_for(&secret), session.expires_at),
        ),
        None => session_required(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UnlockBody {
    code: String,
}

/// `POST /monitor/api/unlock` with `{"code":"1234"}`: trade the passcode for a
/// session. It needs the public Origin, same-origin fetch metadata and a JSON
/// body, but no CSRF token, since there is no session yet.
///
/// A wrong passcode is a 403 that says nothing about how close it was or how
/// many tries are left. After five wrong ones in a row every attempt is a 429,
/// the right passcode included, until the connection is started anew.
pub(super) async fn unlock(policy: &BackendPolicy, request: Request) -> Response {
    if *request.method() != Method::POST {
        return method_not_allowed("POST");
    }
    if check_same_origin(request.headers(), &policy.origin).is_err() {
        return forbidden();
    }
    if !is_json(request.headers()) {
        return plain(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "send the body as application/json.",
        );
    }
    let Ok(bytes) = to_bytes(request.into_body(), MAX_UNLOCK_BODY).await else {
        return plain(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "the request body is too large.",
        );
    };
    let Ok(body) = serde_json::from_slice::<UnlockBody>(&bytes) else {
        return plain(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "the body must be {\"code\":\"....\"}.",
        );
    };
    match policy.unlock.try_unlock(&body.code) {
        Unlock::Granted => start_session(policy),
        Unlock::Wrong => plain(
            StatusCode::FORBIDDEN,
            "unlock_failed",
            "the passcode was not accepted.",
        ),
        Unlock::Locked => plain(
            StatusCode::TOO_MANY_REQUESTS,
            "unlock_locked",
            "too many wrong passcodes. Start the connection again on the PC.",
        ),
    }
}

/// A new session for the passcode that was just accepted.
fn start_session(policy: &BackendPolicy) -> Response {
    let Ok(issued) = policy.sessions.issue(policy.origin.origin(), policy.epoch) else {
        return plain(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "could not start a session.",
        );
    };
    let mut response = json(
        StatusCode::OK,
        &session_body(policy, &issued.csrf, issued.expires_at),
    );
    let cookie = format!(
        "{SESSION_COOKIE_NAME}={}; {SESSION_COOKIE_ATTRIBUTES}; Max-Age={}",
        issued.secret,
        issued.expires_at.saturating_sub(policy.sessions.now())
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// `POST /monitor/api/disconnect`: forget the session and clear its cookie. The
/// passcode keeps working; the page asks for it again.
pub(super) fn disconnect(policy: &BackendPolicy, request: &Request) -> Response {
    if *request.method() != Method::POST {
        return method_not_allowed("POST");
    }
    let Some((secret, session)) = current_session(policy, request.headers()) else {
        return session_required();
    };
    if check_write(request.headers(), &policy.origin, &session).is_err() {
        return forbidden();
    }
    policy.sessions.revoke(&secret);
    let mut response = json(StatusCode::OK, &serde_json::json!({"disconnected": true}));
    let cleared = format!("{SESSION_COOKIE_NAME}=; {SESSION_COOKIE_ATTRIBUTES}; Max-Age=0");
    if let Ok(value) = HeaderValue::from_str(&cleared) {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

#[cfg(test)]
mod tests {
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
            "internal".into(),
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

    const UNLOCK: &str = "/monitor/api/unlock";

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
            "; Path=/monitor/",
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

    #[tokio::test]
    async fn unlock_needs_post_the_page_origin_fetch_site_and_a_small_json_body() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        let good = r#"{"code":"4821"}"#;
        let without = |skip: &str| -> Vec<(&str, &str)> {
            PAGE.iter().filter(|(k, _)| *k != skip).cloned().collect()
        };
        let get = Request::builder()
            .method(Method::GET)
            .uri(UNLOCK)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            unlock(&p, get).await.status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        for (name, pairs, want) in [
            ("no origin", without("origin"), StatusCode::FORBIDDEN),
            (
                "no fetch metadata",
                without("sec-fetch-site"),
                StatusCode::FORBIDDEN,
            ),
            (
                "foreign origin",
                vec![
                    ("origin", "https://evil.example"),
                    ("sec-fetch-site", "same-origin"),
                    ("content-type", "application/json"),
                ],
                StatusCode::FORBIDDEN,
            ),
            (
                "cross-site",
                vec![
                    ("origin", ORIGIN),
                    ("sec-fetch-site", "cross-site"),
                    ("content-type", "application/json"),
                ],
                StatusCode::FORBIDDEN,
            ),
            (
                "not json",
                vec![
                    ("origin", ORIGIN),
                    ("sec-fetch-site", "same-origin"),
                    ("content-type", "text/plain"),
                ],
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ),
            (
                "no content type",
                without("content-type"),
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ),
        ] {
            let r = unlock(&p, post(UNLOCK, &pairs, good)).await;
            assert_eq!(r.status(), want, "{name}");
            assert!(!r.headers().contains_key(header::SET_COOKIE), "{name}");
        }
        for (name, body, want) in [
            ("not json", "4821", StatusCode::BAD_REQUEST),
            ("a number", r#"{"code":4821}"#, StatusCode::BAD_REQUEST),
            ("no code", "{}", StatusCode::BAD_REQUEST),
            (
                "an extra field",
                r#"{"code":"4821","x":1}"#,
                StatusCode::BAD_REQUEST,
            ),
        ] {
            let r = unlock(&p, post(UNLOCK, &PAGE, body)).await;
            assert_eq!(r.status(), want, "{name}");
        }
        let big = format!(r#"{{"code":"{}"}}"#, "1".repeat(4096));
        assert_eq!(
            unlock(&p, post(UNLOCK, &PAGE, &big)).await.status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        // None of the twelve refusals above counted as a wrong guess: the right
        // passcode still works after more than the limit of them.
        assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn five_wrong_passcodes_in_a_row_stop_the_answer_even_to_the_right_one() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        for _ in 0..MAX_FAILURES {
            let wrong = try_code(&p, "0000").await;
            assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
            assert!(!wrong.headers().contains_key(header::SET_COOKIE));
            let body = body_of(wrong).await;
            assert_eq!(body["error"]["code"], "unlock_failed");
            // Nothing says how close the guess was or how many tries are left.
            assert!(!body.to_string().contains(CODE));
            assert!(!body.to_string().to_lowercase().contains("left"));
        }
        for code in ["0000", CODE, CODE] {
            let locked = try_code(&p, code).await;
            assert_eq!(locked.status(), StatusCode::TOO_MANY_REQUESTS, "{code}");
            assert!(!locked.headers().contains_key(header::SET_COOKIE));
            assert_eq!(body_of(locked).await["error"]["code"], "unlock_locked");
        }
        assert!(p.sessions.is_empty());
    }

    #[tokio::test]
    async fn a_success_between_wrong_guesses_resets_the_count() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(try_code(&p, "0000").await.status(), StatusCode::FORBIDDEN);
        }
        assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(try_code(&p, "0000").await.status(), StatusCode::FORBIDDEN);
        }
        assert_eq!(try_code(&p, CODE).await.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn disconnect_forgets_the_session_and_no_longer_points_at_a_logout() {
        let now = Arc::new(AtomicU64::new(0));
        let p = policy(&now, 1, ORIGIN);
        let issued = try_code(&p, CODE).await;
        let mut cookie = cookie_of(&issued);
        let csrf = body_of(issued).await["csrfToken"]
            .as_str()
            .unwrap()
            .to_string();
        cookie.insert(
            HeaderName::from_static("x-agboard-csrf"),
            HeaderValue::from_str(&csrf).unwrap(),
        );
        for (k, v) in [("origin", ORIGIN), ("sec-fetch-site", "same-origin")] {
            cookie.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        let mut request = post("/monitor/api/disconnect", &[], "{}");
        *request.headers_mut() = cookie.clone();
        let r = disconnect(&p, &request);
        assert_eq!(r.status(), StatusCode::OK);
        let cleared = r
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cleared.contains("Max-Age=0") && cleared.contains("Path=/monitor/"));
        let body = body_of(r).await;
        assert_eq!(body, serde_json::json!({"disconnected": true}));
        assert!(current_session(&p, &cookie).is_none());
    }
}
