//! The checks on what a browser hands over when it subscribes.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;

pub(super) const MAX_ENDPOINT: usize = 2048;

/// Whether an endpoint is a public HTTPS push service address: no credentials, no IP address and
/// no single-label host, so the sender is never pointed at the PC's own network.
pub(crate) fn endpoint_ok(endpoint: &str) -> bool {
    if endpoint.len() > MAX_ENDPOINT {
        return false;
    }
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    let host_ok =
        matches!(url.host(), Some(url::Host::Domain(d)) if d.contains('.') && d != "localhost");
    url.scheme() == "https"
        && host_ok
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

pub(super) fn key_ok(text: &str, len: usize, first: Option<u8>) -> bool {
    text.len() <= 128
        && B64
            .decode(text)
            .is_ok_and(|b| b.len() == len && first.is_none_or(|f| b[0] == f))
}
