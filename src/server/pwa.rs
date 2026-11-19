//! What lets a phone add the board to its home screen and receive Web Push: the web app manifest
//! and the service worker. Both hold no token and no board data, so the remote entrance serves
//! them without a session, like the page shell.

use axum::http::header;
use axum::response::{IntoResponse, Response};

/// The service worker. It is served from `/sw.js` so that its scope is the whole board.
pub const SERVICE_WORKER: &str = include_str!("pwa/sw.js");

/// The web app manifest: the board opens full screen from the home screen.
pub const MANIFEST: &str = r##"{
  "name": "Agent Board",
  "short_name": "Agent Board",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/home-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/home-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
"##;

pub(super) async fn manifest() -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/manifest+json"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        MANIFEST,
    )
        .into_response()
}

pub(super) async fn service_worker() -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            // The browser must check for a new worker each time; it caches nothing itself.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        SERVICE_WORKER,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manifest_is_valid_json_for_a_standalone_app() {
        let v: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(v["display"], "standalone");
        assert_eq!(v["start_url"], "/");
    }

    #[test]
    fn the_worker_handles_push_and_clicks_and_caches_nothing() {
        assert!(SERVICE_WORKER.contains("'push'"));
        assert!(SERVICE_WORKER.contains("'notificationclick'"));
        assert!(!SERVICE_WORKER.contains("caches."));
        assert!(!SERVICE_WORKER.contains("'fetch'"));
    }
}
