//! The pages and the embedded web assets.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};

use crate::server::{AppState, assets, web_assets};

/// What the board page may load and do. Scripts, fonts and connections stay on
/// this server; images may come from anywhere so a description can show them.
/// `'unsafe-inline'` for styles is needed because the editor inserts `<style>`
/// elements at run time.
pub(super) const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub(super) fn text_response(content_type: &'static str, body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

pub(super) async fn index(State(state): State<Arc<AppState>>) -> Response {
    let mut response = text_response(
        "text/html; charset=utf-8",
        assets::render_index(assets::INDEX_HTML, state.token.as_str()),
    );
    add_html_security_headers(&mut response);
    response
}

pub(super) fn add_html_security_headers(response: &mut Response) {
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
}

/// A content-named script or stylesheet of the board, cached for a year. Only
/// names in the build's table are served; the name is looked up, never joined
/// to a path.
pub(super) async fn asset(Path(name): Path<String>, headers: HeaderMap) -> Response {
    match web_assets::find(web_assets::APP_ASSETS, &name) {
        Some(asset) => web_assets::response(asset, &headers),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// What the Docs sandbox page may do. It runs the MDX of a document, so it may build code at run time
/// (`'unsafe-eval'`) but may not connect anywhere: the page and its script come from this server,
/// and nothing else can be fetched, framed or submitted. The board embeds it in an iframe whose
/// `sandbox` has no `allow-same-origin`, so the page is cut off from the board's token and storage.
pub(super) const SANDBOX_CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/// The Docs sandbox page: a fixed page that holds no token and nothing of the board, around the
/// content-named sandbox script.
pub(super) async fn docs_sandbox() -> Response {
    let Some(script) = web_assets::SANDBOX_ASSETS.first() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let html = format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n<title>Docs sandbox</title>\n<style>html,body{{margin:0;padding:0}}</style>\n</head>\n<body>\n<div id=\"root\"></div>\n<script src=\"/docs-sandbox/{}\"></script>\n</body>\n</html>\n",
        script.name
    );
    let mut response = text_response("text/html; charset=utf-8", html);
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(SANDBOX_CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    response
}

/// The sandbox script, by its content-named file.
pub(super) async fn docs_sandbox_asset(Path(name): Path<String>, headers: HeaderMap) -> Response {
    match web_assets::find(web_assets::SANDBOX_ASSETS, &name) {
        Some(asset) => {
            let mut response = web_assets::response(asset, &headers);
            response.headers_mut().insert(
                header::X_CONTENT_TYPE_OPTIONS,
                header::HeaderValue::from_static("nosniff"),
            );
            response
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub(super) async fn logo_png() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        assets::LOGO_PNG,
    )
        .into_response()
}

pub(super) async fn logo_white_png() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        assets::LOGO_WHITE_PNG,
    )
        .into_response()
}
