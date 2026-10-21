//! The monitor's narrowly scoped write surface: answer a pending question.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use crate::server::AppState;
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
    if !page_path && !answer_path {
        return next.run(request).await;
    }
    if page_path && matches!(*request.method(), Method::GET | Method::HEAD) {
        return next.run(request).await;
    }
    if answer_path
        && matches!(*request.method(), Method::POST)
        && guard::board_write_allowed(request.headers(), &state.guard)
    {
        return next.run(request).await;
    }
    if !matches!(*request.method(), Method::POST) {
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
mod tests {
    use std::collections::HashSet;
    use std::sync::RwLock;

    use tokio::sync::broadcast;

    use super::*;
    use crate::file_store::index::ProjectIndex;
    use crate::file_store::watch::Watch;
    use crate::server::MonitorOptions;
    use crate::server::monitor_connection::config::ConfigStore;
    use crate::server::monitor_connection::lifecycle::{MonitorConnections, MonitorEnv};

    const ORIGIN: &str = "https://m.ngrok.app";
    const HOST: &str = "m.ngrok.app";
    const TOKEN: &str = "0123456789abcdef";
    const PATH: &str = "/monitor/api/projects/p/tasks/1/answer";

    /// The write router on a loopback port, behind a guard with a known token.
    async fn serve() -> (String, tempfile::TempDir, Watch) {
        let home = tempfile::tempdir().unwrap();
        let shared = home.path().join("shared");
        let index = Arc::new(RwLock::new(ProjectIndex::default()));
        let (changed, _) = broadcast::channel(4);
        let (watch, reloader) = Watch::start(&shared, index.clone(), changed.clone()).unwrap();
        let options = MonitorOptions::without_keychain(MonitorEnv::default(), false);
        let app = Arc::new(AppState {
            port: 0,
            token: "page".into(),
            shared,
            index,
            reloader,
            changed,
            preferences: crate::server::preferences::PreferencesStore::new(home.path()),
            preferences_changed: broadcast::channel(4).0,
            monitor: MonitorConnections::new(
                ConfigStore::new(home.path()),
                options.connector,
                options.vault,
                options.env,
            ),
        });
        let guard = BoardWriteGuard {
            origins: Arc::new(HashSet::from([ORIGIN.to_string()])),
            authorities: Arc::new(HashSet::from([HOST.to_string()])),
            token: TOKEN.into(),
        };
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router(app, guard)).await });
        (format!("http://{addr}"), home, watch)
    }

    async fn post(base: &str, headers: &[(&str, &str)]) -> (u16, String) {
        let mut request = reqwest::Client::new()
            .post(format!("{base}{PATH}"))
            .header("Content-Type", "application/json")
            .body(r#"{"requestId":"stale","text":"answer"}"#);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = request.send().await.unwrap();
        (response.status().as_u16(), response.text().await.unwrap())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_answer_needs_the_host_origin_fetch_site_and_the_guards_token() {
        let (base, _home, _watch) = serve().await;
        let good = [
            ("Host", HOST),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
        ];
        let with = |extra: &[(&'static str, &'static str)]| {
            let mut all = good.to_vec();
            all.extend_from_slice(extra);
            all
        };

        // Everything but the token is right: the page is out of date.
        for token in [None, Some("wrong"), Some("old-monitor-token")] {
            let headers = match token {
                Some(token) => with(&[("X-Agboard-Token", token)]),
                None => with(&[]),
            };
            let (status, body) = post(&base, &headers).await;
            assert_eq!(status, 403, "{token:?}: {body}");
            assert!(body.contains("page_out_of_date"), "{token:?}: {body}");
        }

        // Any other condition missing is a plain refusal, even with the token.
        for headers in [
            vec![
                ("Host", HOST),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Token", TOKEN),
            ],
            vec![
                ("Host", HOST),
                ("Origin", "https://evil.example"),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Token", TOKEN),
            ],
            vec![
                ("Host", "other.example"),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-origin"),
                ("X-Agboard-Token", TOKEN),
            ],
            vec![
                ("Host", HOST),
                ("Origin", ORIGIN),
                ("Sec-Fetch-Site", "same-site"),
                ("X-Agboard-Token", TOKEN),
            ],
            with(&[
                ("X-Agboard-Token", TOKEN),
                ("X-HTTP-Method-Override", "DELETE"),
            ]),
        ] {
            let (status, body) = post(&base, &headers).await;
            assert_eq!(status, 403, "{headers:?}: {body}");
            assert!(!body.contains("page_out_of_date"), "{headers:?}: {body}");
        }

        // With every condition met the guard lets the request through.
        let (status, body) = post(&base, &with(&[("X-Agboard-Token", TOKEN)])).await;
        assert_ne!(status, 403, "{body}");

        // Only POST reaches the answer route.
        let response = reqwest::Client::new()
            .get(format!("{base}{PATH}"))
            .header("Host", HOST)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 405);
    }

    async fn put_preferences_request(
        base: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (u16, String) {
        let mut request = reqwest::Client::new()
            .put(format!("{base}/monitor/api/preferences"))
            .header("Content-Type", "application/json")
            .body(body.to_string());
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = request.send().await.unwrap();
        (response.status().as_u16(), response.text().await.unwrap())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_preference_save_needs_the_same_guards_as_an_answer() {
        let (base, home, _watch) = serve().await;
        let good = [
            ("Host", HOST),
            ("Origin", ORIGIN),
            ("Sec-Fetch-Site", "same-origin"),
            ("X-Agboard-Token", TOKEN),
        ];
        let body = r#"{"locale":"ja"}"#;

        // Without one of the guards nothing is saved.
        for missing in ["Origin", "Sec-Fetch-Site", "X-Agboard-Token"] {
            let headers: Vec<_> = good
                .iter()
                .copied()
                .filter(|(n, _)| *n != missing)
                .collect();
            let (status, body_text) = put_preferences_request(&base, &headers, body).await;
            assert!(
                status == 403 || status == 405,
                "{missing}: {status} {body_text}"
            );
        }
        assert_eq!(
            crate::server::preferences::PreferencesStore::new(home.path())
                .load()
                .locale,
            "en"
        );

        // With every guard the save goes through and reads back.
        let (status, body_text) = put_preferences_request(&base, &good, body).await;
        assert_eq!(status, 200, "{body_text}");
        let read = reqwest::Client::new()
            .get(format!("{base}/monitor/api/preferences"))
            .header("Host", HOST)
            .send()
            .await
            .unwrap();
        assert_eq!(read.status().as_u16(), 200);
        let json: serde_json::Value = read.json().await.unwrap();
        assert_eq!(json["locale"], "ja");
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(json["revision"].as_u64().unwrap() >= now_millis - 60_000);

        // A value outside the choices is refused and changes nothing.
        let (status, body_text) = put_preferences_request(&base, &good, r#"{"locale":"fr"}"#).await;
        assert_eq!(status, 422, "{body_text}");
        assert!(body_text.contains("invalid_preferences"), "{body_text}");
    }
}
