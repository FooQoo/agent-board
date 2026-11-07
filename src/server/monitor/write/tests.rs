use std::collections::HashSet;
use std::sync::RwLock;

use tokio::sync::broadcast;

use super::*;
use crate::file_store::index::ProjectIndex;
use crate::file_store::watch::{DocsSink, Watch, WatchMode};
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
    let changed = crate::server::change_feed::ChangeFeed::new();
    let (watch, reloader) = Watch::start_with_docs(
        &shared,
        WatchMode::Poll,
        index.clone(),
        changed.sink(),
        DocsSink::none(),
    )
    .unwrap();
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
        docs_changed: broadcast::channel(4).0,
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
