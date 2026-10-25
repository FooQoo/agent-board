//! The board's and the monitor's scripts and stylesheets, which `build.rs`
//! embeds gzip-compressed. Every file is named by its content, so a response
//! may be kept by the browser for a year: a new build loads new names from the
//! HTML, which is never cached.

use std::io::Read as _;

use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

/// One embedded file: its name in the build, its type and its gzip bytes.
pub struct EmbeddedAsset {
    pub name: &'static str,
    pub mime: &'static str,
    pub gzip: &'static [u8],
}

// `APP_ASSETS`, `MONITOR_ASSETS`, `SANDBOX_ASSETS`, `APP_BUILD_ID` and `MONITOR_BUILD_ID`.
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));

/// What the web build leaves in each page's `agboard-build` `<meta>`.
pub const BUILD_ID_PLACEHOLDER: &str = "{{AGBOARD_BUILD_ID}}";

/// For a content-named file: the browser keeps it and never asks again.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// The file named `name`. Only names in the table are found, so `..`, `/` and
/// any other name are `None`.
pub fn find(table: &'static [EmbeddedAsset], name: &str) -> Option<&'static EmbeddedAsset> {
    table.iter().find(|asset| asset.name == name)
}

/// `asset` as a cacheable response: the gzip bytes when the request accepts
/// gzip, otherwise the decompressed bytes.
pub fn response(asset: &EmbeddedAsset, request: &HeaderMap) -> Response {
    let mut response = if accepts_gzip(request) {
        let mut response = asset.gzip.into_response();
        response
            .headers_mut()
            .insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        response
    } else {
        let mut bytes = Vec::new();
        match flate2::read::GzDecoder::new(asset.gzip).read_to_end(&mut bytes) {
            Ok(_) => bytes.into_response(),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    };
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(asset.mime));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE));
    headers.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    response
}

/// Whether `Accept-Encoding` allows gzip: `gzip` or `*` with a non-zero `q`.
fn accepts_gzip(request: &HeaderMap) -> bool {
    request
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|item| {
            let mut parts = item.split(';').map(str::trim);
            let coding = parts.next().unwrap_or_default();
            let allowed = parts
                .filter_map(|param| param.strip_prefix("q="))
                .all(|q| q.parse::<f32>().is_ok_and(|q| q > 0.0));
            (coding.eq_ignore_ascii_case("gzip") || coding == "*") && allowed
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    fn headers(accept: &str) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(
            header::ACCEPT_ENCODING,
            HeaderValue::from_str(accept).unwrap(),
        );
        map
    }

    #[test]
    fn gzip_is_accepted_by_name_or_wildcard_unless_its_q_is_zero() {
        for accept in ["gzip", "br, gzip", "GZIP;q=0.5", "*", "deflate, *;q=0.1"] {
            assert!(accepts_gzip(&headers(accept)), "{accept}");
        }
        for accept in ["", "br", "identity", "gzip;q=0", "gzip;q=0.0", "x-gzip-ish"] {
            assert!(!accepts_gzip(&headers(accept)), "{accept}");
        }
        assert!(!accepts_gzip(&HeaderMap::new()));
    }

    #[test]
    fn the_tables_hold_only_content_named_scripts_and_stylesheets() {
        assert!(!APP_ASSETS.is_empty() && !MONITOR_ASSETS.is_empty());
        for asset in APP_ASSETS.iter().chain(MONITOR_ASSETS) {
            let name = asset.name;
            assert!(!name.contains('/') && !name.contains(".."), "{name}");
            assert!(name.ends_with(".js") || name.ends_with(".css"), "{name}");
            assert!(asset.gzip.starts_with(&[0x1f, 0x8b]), "{name}");
        }
        assert_eq!(APP_BUILD_ID.len(), 16);
        assert_eq!(MONITOR_BUILD_ID.len(), 16);
    }

    #[test]
    fn a_file_both_builds_contain_is_embedded_once() {
        // The monitor reuses the board's diagram chunks under the same names.
        let shared = MONITOR_ASSETS
            .iter()
            .filter_map(|asset| Some((asset, find(APP_ASSETS, asset.name)?)))
            .collect::<Vec<_>>();
        assert!(
            shared
                .iter()
                .any(|(asset, _)| asset.name.starts_with("chunk-mermaid.core-"))
        );
        for (monitor, board) in shared {
            assert!(std::ptr::eq(board.gzip, monitor.gzip), "{}", monitor.name);
        }
    }

    #[test]
    fn only_listed_names_are_found() {
        let first = APP_ASSETS[0].name;
        assert!(find(APP_ASSETS, first).is_some());
        for name in [
            "",
            "app.js",
            "../x.js",
            &format!("{first}/"),
            &format!("./{first}"),
        ] {
            assert!(find(APP_ASSETS, name).is_none(), "{name:?}");
        }
    }

    #[tokio::test]
    async fn a_response_is_gzip_or_plain_and_always_cacheable() {
        let asset = &APP_ASSETS[0];
        let zipped = response(asset, &headers("gzip, br"));
        assert_eq!(zipped.headers()[header::CONTENT_ENCODING], "gzip");
        assert_eq!(zipped.headers()[header::CACHE_CONTROL], IMMUTABLE);
        assert_eq!(zipped.headers()[header::VARY], "accept-encoding");
        let body = to_bytes(zipped.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], asset.gzip);

        let plain = response(asset, &HeaderMap::new());
        assert!(plain.headers().get(header::CONTENT_ENCODING).is_none());
        assert_eq!(plain.headers()[header::CONTENT_TYPE], asset.mime);
        assert_eq!(plain.headers()[header::CACHE_CONTROL], IMMUTABLE);
        let body = to_bytes(plain.into_body(), usize::MAX).await.unwrap();
        let mut expected = Vec::new();
        flate2::read::GzDecoder::new(asset.gzip)
            .read_to_end(&mut expected)
            .unwrap();
        assert_eq!(&body[..], &expected[..]);
    }
}
