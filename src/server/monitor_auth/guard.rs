//! Header checks for requests that reach the ngrok monitor backend. Pure
//! functions over header maps, so they can be tested without a server.

use axum::http::{HeaderMap, HeaderName, header};

use super::contracts::SESSION_COOKIE_NAME;
use crate::server::monitor_connection::contracts::{ContractError, PublicOrigin};

/// The header a page sends its CSRF token in.
pub const CSRF_HEADER: &str = "x-agboard-csrf";

/// The value of the session cookie, if there is exactly one.
pub fn session_cookie(headers: &HeaderMap) -> Option<String> {
    let mut found = None;
    for value in headers.get_all(header::COOKIE) {
        for pair in value.to_str().ok()?.split(';') {
            let Some((name, value)) = pair.trim().split_once('=') else {
                continue;
            };
            if name == SESSION_COOKIE_NAME {
                if found.is_some() || value.is_empty() {
                    return None;
                }
                found = Some(value.to_string());
            }
        }
    }
    found
}

/// The single CSRF header value.
pub fn csrf_token(headers: &HeaderMap) -> Option<&str> {
    let mut values = headers.get_all(HeaderName::from_static(CSRF_HEADER)).iter();
    let first = values.next()?;
    if values.next().is_some() {
        return None;
    }
    first.to_str().ok()
}

/// Headers that can change the method are refused outright.
pub fn has_method_override(headers: &HeaderMap) -> bool {
    ["x-http-method-override", "x-method-override"]
        .iter()
        .any(|name| headers.contains_key(*name))
}

/// Remove what the ngrok Edge or a client adds and the app must never trust:
/// forwarding and identity headers, a client-chosen token, and authorization.
/// Call it only after the Host has been checked.
pub fn strip_untrusted(headers: &mut HeaderMap) {
    let names: Vec<HeaderName> = headers
        .keys()
        .filter(|name| {
            let n = name.as_str();
            n.starts_with("x-forwarded-")
                || n.starts_with("ngrok-")
                || matches!(
                    n,
                    "forwarded"
                        | "x-original-host"
                        | "x-real-ip"
                        | "x-agboard-token"
                        | "authorization"
                        | "proxy-authorization"
                )
        })
        .cloned()
        .collect();
    for name in names {
        headers.remove(name);
    }
}

/// Why a state-changing request was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum WriteRefusal {
    Origin(ContractError),
    FetchSite,
    Csrf,
}

/// A request that changes something must come from the monitor page itself:
/// the public Origin and `same-origin` fetch metadata.
pub fn check_same_origin(headers: &HeaderMap, origin: &PublicOrigin) -> Result<(), WriteRefusal> {
    origin.check_origin(headers).map_err(WriteRefusal::Origin)?;
    let mut site = headers.get_all("sec-fetch-site").iter();
    match (site.next(), site.next()) {
        (Some(v), None) if v.as_bytes() == b"same-origin" => Ok(()),
        _ => Err(WriteRefusal::FetchSite),
    }
}

/// Whether the body is declared as JSON (`application/json`, parameters allowed).
pub fn is_json(headers: &HeaderMap) -> bool {
    let mut values = headers.get_all(header::CONTENT_TYPE).iter();
    match (values.next(), values.next()) {
        (Some(v), None) => v.to_str().is_ok_and(|text| {
            text.split(';')
                .next()
                .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/json"))
        }),
        _ => false,
    }
}

/// A state-changing request needs the public Origin, `same-origin` fetch
/// metadata and the session's CSRF token.
pub fn check_write(
    headers: &HeaderMap,
    origin: &PublicOrigin,
    session: &super::contracts::AuthSession,
) -> Result<(), WriteRefusal> {
    check_same_origin(headers, origin)?;
    match csrf_token(headers) {
        Some(token) if session.csrf_matches(token) => Ok(()),
        _ => Err(WriteRefusal::Csrf),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;
    use crate::server::monitor_auth::contracts::AuthSession;

    fn map(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn the_session_cookie_must_appear_exactly_once() {
        let name = SESSION_COOKIE_NAME;
        assert_eq!(
            session_cookie(&map(&[("cookie", &format!("a=b; {name}=abc"))])),
            Some("abc".into())
        );
        assert_eq!(session_cookie(&map(&[])), None);
        assert_eq!(
            session_cookie(&map(&[("cookie", &format!("{name}=a; {name}=b"))])),
            None
        );
        assert_eq!(
            session_cookie(&map(&[
                ("cookie", &format!("{name}=a")),
                ("cookie", &format!("{name}=b"))
            ])),
            None
        );
        assert_eq!(
            session_cookie(&map(&[("cookie", &format!("{name}="))])),
            None
        );
    }

    #[test]
    fn untrusted_headers_are_removed_and_the_rest_kept() {
        let mut h = map(&[
            ("forwarded", "for=1.2.3.4"),
            ("x-forwarded-host", "evil"),
            ("x-forwarded-for", "1.2.3.4"),
            ("ngrok-auth-user-email", "me@example.com"),
            ("x-agboard-token", "client"),
            ("authorization", "Bearer x"),
            ("x-agboard-language", "ja"),
            ("host", "a.ngrok.app"),
        ]);
        strip_untrusted(&mut h);
        let left: Vec<_> = h.keys().map(|k| k.as_str().to_string()).collect();
        assert_eq!(left.len(), 2, "{left:?}");
        assert!(h.contains_key("x-agboard-language") && h.contains_key("host"));
    }

    #[test]
    fn a_write_needs_origin_fetch_site_and_csrf() {
        let origin = PublicOrigin::parse("https://a.ngrok.app").unwrap();
        let session = AuthSession::issue("s", "csrf-1", "https://a.ngrok.app", 1, 0, 60);
        let good = [
            ("origin", "https://a.ngrok.app"),
            ("sec-fetch-site", "same-origin"),
            (CSRF_HEADER, "csrf-1"),
        ];
        assert_eq!(check_write(&map(&good), &origin, &session), Ok(()));
        let without = |skip: &str| {
            let pairs: Vec<_> = good.iter().filter(|(k, _)| *k != skip).cloned().collect();
            check_write(&map(&pairs), &origin, &session)
        };
        assert!(matches!(without("origin"), Err(WriteRefusal::Origin(_))));
        assert_eq!(without("sec-fetch-site"), Err(WriteRefusal::FetchSite));
        assert_eq!(without(CSRF_HEADER), Err(WriteRefusal::Csrf));
        let wrong = map(&[
            ("origin", "https://a.ngrok.app"),
            ("sec-fetch-site", "cross-site"),
            (CSRF_HEADER, "csrf-1"),
        ]);
        assert_eq!(
            check_write(&wrong, &origin, &session),
            Err(WriteRefusal::FetchSite)
        );
        let bad_csrf = map(&[
            ("origin", "https://a.ngrok.app"),
            ("sec-fetch-site", "same-origin"),
            (CSRF_HEADER, "nope"),
        ]);
        assert_eq!(
            check_write(&bad_csrf, &origin, &session),
            Err(WriteRefusal::Csrf)
        );
        assert!(has_method_override(&map(&[(
            "x-method-override",
            "DELETE"
        )])));
    }

    #[test]
    fn the_page_itself_is_the_origin_and_fetch_site_without_a_session() {
        let origin = PublicOrigin::parse("https://a.ngrok.app").unwrap();
        let good = [
            ("origin", "https://a.ngrok.app"),
            ("sec-fetch-site", "same-origin"),
        ];
        assert_eq!(check_same_origin(&map(&good), &origin), Ok(()));
        assert!(matches!(
            check_same_origin(&map(&good[1..]), &origin),
            Err(WriteRefusal::Origin(_))
        ));
        for site in ["cross-site", "same-site", "none"] {
            assert_eq!(
                check_same_origin(
                    &map(&[("origin", "https://a.ngrok.app"), ("sec-fetch-site", site)]),
                    &origin
                ),
                Err(WriteRefusal::FetchSite)
            );
        }
        assert_eq!(
            check_same_origin(&map(&good[..1]), &origin),
            Err(WriteRefusal::FetchSite)
        );
    }

    #[test]
    fn a_json_body_is_declared_once_as_application_json() {
        assert!(is_json(&map(&[("content-type", "application/json")])));
        assert!(is_json(&map(&[(
            "content-type",
            "Application/JSON; charset=utf-8"
        )])));
        assert!(!is_json(&map(&[])));
        assert!(!is_json(&map(&[("content-type", "text/plain")])));
        assert!(!is_json(&map(&[("content-type", "application/jsonx")])));
        assert!(!is_json(&map(&[
            ("content-type", "application/json"),
            ("content-type", "application/json")
        ])));
    }
}
