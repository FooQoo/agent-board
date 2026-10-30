//! Request guards: which `Host` is accepted for every request, and the four
//! conditions a browser delete must meet. Pure functions over header values so
//! they can be tested exhaustively; the HTTP layer only extracts the values.
//!
//! The header-map checks below are shared by the board router and the
//! monitor's write surface behind the ngrok entry: local writes, monitor writes
//! and HTTPS origins.

use std::sync::Arc;

use axum::http::HeaderMap;

/// Headers of a `DELETE /api/tasks/{id}` request, as the guard sees them.
/// `None` means the header is absent (or not usable text).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DeleteRequest<'a> {
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub sec_fetch_site: Option<&'a str>,
    pub token: Option<&'a str>,
}

/// The first delete condition that a request does not meet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denial {
    Host,
    Origin,
    FetchSite,
    Token,
}

/// `Host` must be `127.0.0.1:<port>` or `localhost:<port>`. Host names are
/// case-insensitive; the port must be written exactly as the server's.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    let host = host.to_ascii_lowercase();
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

/// `Origin` must be `http://127.0.0.1:<port>` or `http://localhost:<port>`.
pub fn origin_allowed(origin: Option<&str>, port: u16) -> bool {
    let Some(origin) = origin else { return false };
    origin == format!("http://127.0.0.1:{port}") || origin == format!("http://localhost:{port}")
}

/// `Sec-Fetch-Site` must be `same-origin`.
pub fn fetch_site_allowed(site: Option<&str>) -> bool {
    site == Some("same-origin")
}

/// The `X-Agboard-Token` value must equal the server's token. An empty expected
/// token never matches. The comparison does not stop at the first difference.
pub fn token_matches(provided: Option<&str>, expected: &str) -> bool {
    let Some(provided) = provided else {
        return false;
    };
    if expected.is_empty() || provided.len() != expected.len() {
        return false;
    }
    provided
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

/// Check all four delete conditions, in the order Host, Origin,
/// Sec-Fetch-Site, token.
pub fn check_delete(request: &DeleteRequest, port: u16, token: &str) -> Result<(), Denial> {
    if !host_allowed(request.host, port) {
        return Err(Denial::Host);
    }
    if !origin_allowed(request.origin, port) {
        return Err(Denial::Origin);
    }
    if !fetch_site_allowed(request.sec_fetch_site) {
        return Err(Denial::FetchSite);
    }
    if !token_matches(request.token, token) {
        return Err(Denial::Token);
    }
    Ok(())
}

// ---------------------------------------------------------------- header maps

/// The single text value of a header, or `None` if it is absent, repeated or
/// not text.
pub(crate) fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

/// What the monitor's write surface accepts: the canonical HTTPS origins and
/// their authorities, and the token that only the entry in front can add.
#[derive(Clone)]
pub(crate) struct BoardWriteGuard {
    pub origins: Arc<std::collections::HashSet<String>>,
    pub authorities: Arc<std::collections::HashSet<String>>,
    pub token: String,
}

/// Whether a local write meets every condition of [`check_delete`].
pub(crate) fn write_allowed(headers: &HeaderMap, port: u16, token: &str) -> bool {
    write_refusal(headers, port, token).is_none()
}

/// Why a local write is refused, if it is. The checks run in the order of `check_delete`.
pub(crate) fn write_refusal(headers: &HeaderMap, port: u16, token: &str) -> Option<Denial> {
    let request = DeleteRequest {
        host: header_text(headers, "host"),
        origin: header_text(headers, "origin"),
        sec_fetch_site: header_text(headers, "sec-fetch-site"),
        token: header_text(headers, "x-agboard-token"),
    };
    check_delete(&request, port, token).err()
}

/// Whether a write to the monitor surface comes from its page: no
/// forwarding or method-override header, an allowed HTTPS `Origin` whose
/// authority is the `Host`, `same-origin`, and the guard's token.
pub(crate) fn board_write_allowed(headers: &HeaderMap, guard: &BoardWriteGuard) -> bool {
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
    let host = header_text(headers, "host");
    let origin = header_text(headers, "origin");
    let site = header_text(headers, "sec-fetch-site");
    let token = header_text(headers, "x-agboard-token");
    let Some(origin) = origin.and_then(canonical_https_origin) else {
        return false;
    };
    guard.origins.contains(&origin.0)
        && host
            .and_then(canonical_https_authority)
            .is_some_and(|host| host == origin.1)
        && site == Some("same-origin")
        && token_matches(token, &guard.token)
}

/// An HTTPS origin written canonically, and its authority. `None` for anything
/// that is not a bare `https://host[:port]`.
pub(crate) fn canonical_https_origin(origin: &str) -> Option<(String, String)> {
    let (scheme, authority) = origin.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("https")
        || authority.is_empty()
        || authority.contains(['/', '?', '#', '@'])
    {
        return None;
    }
    let authority = canonical_https_authority(authority)?;
    Some((format!("https://{authority}"), authority))
}

/// A `host[:port]` with the host in lower case and the default port 443 left out.
pub(crate) fn canonical_https_authority(raw: &str) -> Option<String> {
    let authority = raw.parse::<axum::http::uri::Authority>().ok()?;
    if authority.as_str().contains('@') {
        return None;
    }
    let host = authority.host();
    if host.is_empty() {
        return None;
    }
    let port = authority.port_u16().unwrap_or(443);
    Some(if port == 443 {
        host.to_ascii_lowercase()
    } else {
        format!("{}:{port}", host.to_ascii_lowercase())
    })
}

#[cfg(test)]
mod tests;
