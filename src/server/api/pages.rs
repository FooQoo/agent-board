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
pub(super) const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
