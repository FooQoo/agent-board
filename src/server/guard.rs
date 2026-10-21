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
mod tests {
    use super::*;

    const PORT: u16 = 7610;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn good() -> DeleteRequest<'static> {
        DeleteRequest {
            host: Some("127.0.0.1:7610"),
            origin: Some("http://127.0.0.1:7610"),
            sec_fetch_site: Some("same-origin"),
            token: Some(TOKEN),
        }
    }

    #[test]
    fn host_accepts_loopback_and_localhost_with_the_server_port() {
        for host in [
            "127.0.0.1:7610",
            "localhost:7610",
            "LOCALHOST:7610",
            "Localhost:7610",
        ] {
            assert!(host_allowed(Some(host), PORT), "{host}");
        }
    }

    #[test]
    fn host_rejects_everything_else() {
        for host in [
            "",
            "evil.example:7610",
            "evil.example",
            "127.0.0.1",
            "localhost",
            "127.0.0.1:7611",
            "localhost:7611",
            "127.0.0.1:07610",
            "127.0.0.1:",
            "127.0.0.1:7610.evil.example",
            "127.0.0.1:7610@evil.example",
            "evil.example@127.0.0.1:7610",
            "localhost.evil.example:7610",
            "xlocalhost:7610",
            "localhost:7610:7610",
            " 127.0.0.1:7610",
            "127.0.0.1:7610 ",
            "[::1]:7610",
            "0.0.0.0:7610",
            "localhost.:7610",
            "http://127.0.0.1:7610",
        ] {
            assert!(!host_allowed(Some(host), PORT), "{host:?}");
        }
        assert!(!host_allowed(None, PORT));
    }

    #[test]
    fn host_follows_the_port_it_is_given() {
        assert!(host_allowed(Some("127.0.0.1:50123"), 50123));
        assert!(!host_allowed(Some("127.0.0.1:7610"), 50123));
    }

    #[test]
    fn origin_accepts_only_the_servers_own_http_origins() {
        assert!(origin_allowed(Some("http://127.0.0.1:7610"), PORT));
        assert!(origin_allowed(Some("http://localhost:7610"), PORT));
        for origin in [
            "",
            "null",
            "http://evil.example",
            "http://evil.example:7610",
            "https://127.0.0.1:7610",
            "http://127.0.0.1",
            "http://127.0.0.1:7611",
            "http://127.0.0.1:7610/",
            "http://127.0.0.1:7610.evil.example",
            "http://localhost:7610@evil.example",
            "http://LOCALHOST:7610",
            "127.0.0.1:7610",
        ] {
            assert!(!origin_allowed(Some(origin), PORT), "{origin:?}");
        }
        assert!(!origin_allowed(None, PORT));
    }

    #[test]
    fn fetch_site_accepts_only_same_origin() {
        assert!(fetch_site_allowed(Some("same-origin")));
        for site in ["cross-site", "same-site", "none", "", "Same-Origin"] {
            assert!(!fetch_site_allowed(Some(site)), "{site:?}");
        }
        assert!(!fetch_site_allowed(None));
    }

    #[test]
    fn token_must_match_exactly() {
        assert!(token_matches(Some(TOKEN), TOKEN));
        let mut wrong_last = TOKEN.to_string();
        wrong_last.replace_range(63.., "0");
        let longer = format!("{TOKEN}0");
        for provided in [
            "",
            "0",
            &TOKEN[..63],
            wrong_last.as_str(),
            longer.as_str(),
            &TOKEN.to_uppercase(),
        ] {
            assert!(!token_matches(Some(provided), TOKEN), "{provided:?}");
        }
        assert!(!token_matches(None, TOKEN));
    }

    #[test]
    fn an_empty_expected_token_never_matches() {
        assert!(!token_matches(Some(""), ""));
        assert!(!token_matches(None, ""));
    }

    #[test]
    fn a_request_meeting_all_four_conditions_is_allowed() {
        assert_eq!(check_delete(&good(), PORT, TOKEN), Ok(()));
        let localhost = DeleteRequest {
            host: Some("localhost:7610"),
            origin: Some("http://localhost:7610"),
            ..good()
        };
        assert_eq!(check_delete(&localhost, PORT, TOKEN), Ok(()));
    }

    #[test]
    fn each_missing_condition_denies_the_delete() {
        let cases = [
            (
                "host missing",
                DeleteRequest {
                    host: None,
                    ..good()
                },
                Denial::Host,
            ),
            (
                "host wrong",
                DeleteRequest {
                    host: Some("evil.example:7610"),
                    ..good()
                },
                Denial::Host,
            ),
            (
                "origin missing",
                DeleteRequest {
                    origin: None,
                    ..good()
                },
                Denial::Origin,
            ),
            (
                "origin wrong",
                DeleteRequest {
                    origin: Some("http://evil.example"),
                    ..good()
                },
                Denial::Origin,
            ),
            (
                "fetch site missing",
                DeleteRequest {
                    sec_fetch_site: None,
                    ..good()
                },
                Denial::FetchSite,
            ),
            (
                "fetch site cross-site",
                DeleteRequest {
                    sec_fetch_site: Some("cross-site"),
                    ..good()
                },
                Denial::FetchSite,
            ),
            (
                "token missing",
                DeleteRequest {
                    token: None,
                    ..good()
                },
                Denial::Token,
            ),
            (
                "token wrong",
                DeleteRequest {
                    token: Some("nope"),
                    ..good()
                },
                Denial::Token,
            ),
        ];
        for (name, request, denial) in cases {
            assert_eq!(check_delete(&request, PORT, TOKEN), Err(denial), "{name}");
        }
    }

    #[test]
    fn a_request_with_no_headers_is_denied_and_the_host_is_reported_first() {
        assert_eq!(
            check_delete(&DeleteRequest::default(), PORT, TOKEN),
            Err(Denial::Host)
        );
    }

    #[test]
    fn a_wrong_origin_scheme_or_port_is_not_rescued_by_a_valid_token() {
        let request = DeleteRequest {
            origin: Some("http://127.0.0.1:7611"),
            ..good()
        };
        assert_eq!(check_delete(&request, PORT, TOKEN), Err(Denial::Origin));
    }
}
