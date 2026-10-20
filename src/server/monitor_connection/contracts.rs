//! Contracts for the built-in ngrok monitor connection: configuration and status
//! types, input validation, the Traffic Policy generator, the per-start tunnel
//! proof, public Origin/Host checks, and the SDK entry point.
//!
//! Nothing here starts a tunnel on its own. The HTTP stack that serves the
//! monitor builds on these types.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Header the Edge policy sets after authentication and authorization.
pub const PROOF_HEADER: &str = "x-agboard-tunnel-proof";

/// Upper bound on allowed emails, to keep the policy small.
pub const MAX_ALLOWED_EMAILS: usize = 50;

/// Which Google OAuth app the Edge uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OauthApp {
    /// ngrok's managed Google app.
    #[default]
    Managed,
    /// An app owned by the user; the client id and secret come from the environment.
    Custom,
}

/// Lifecycle state of the connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Disabled,
    NeedsConfig,
    Starting,
    Ready,
    Reconnecting,
    Failed,
    Stopping,
}

/// The non-secret configuration that may be saved to disk.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionConfig {
    pub enabled: bool,
    pub allow_emails: Vec<String>,
    pub domain: Option<String>,
    pub oauth_app: OauthApp,
    pub revision: u64,
}

/// Why an input or request was refused. Messages never include secret values.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ContractError {
    #[error("at least one allowed email is required")]
    NoAllowedEmail,
    #[error("too many allowed emails (maximum {MAX_ALLOWED_EMAILS})")]
    TooManyEmails,
    #[error("invalid allowed email")]
    InvalidEmail,
    #[error("invalid domain")]
    InvalidDomain,
    #[error("the public URL must be a plain https origin")]
    InvalidPublicUrl,
    #[error("custom OAuth app requires a client id and secret")]
    MissingOauthCredentials,
    #[error("the tunnel proof header is missing")]
    ProofMissing,
    #[error("the tunnel proof header is repeated")]
    ProofDuplicate,
    #[error("the tunnel proof does not match")]
    ProofMismatch,
    #[error("the Host header does not match the public origin")]
    HostMismatch,
    #[error("the Origin header does not match the public origin")]
    OriginMismatch,
}

/// Validate one allowed email and return its canonical (lowercase) form.
///
/// Only a conservative ASCII subset is accepted. Quotes, backslashes, spaces and
/// control characters are rejected rather than escaped.
pub fn normalize_email(raw: &str) -> Result<String, ContractError> {
    let email = raw.to_ascii_lowercase();
    if email.is_empty() || email.len() > 254 {
        return Err(ContractError::InvalidEmail);
    }
    let ok_char = |c: char| c.is_ascii_alphanumeric() || "._%+-".contains(c);
    let (local, domain) = email.split_once('@').ok_or(ContractError::InvalidEmail)?;
    if local.is_empty()
        || local.len() > 64
        || !local.chars().all(ok_char)
        || domain.contains('@')
        || !valid_hostname(domain)
    {
        return Err(ContractError::InvalidEmail);
    }
    Ok(email)
}

fn valid_hostname(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || !host.contains('.') {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

/// Validate an optional ngrok domain: a bare host with no scheme, path, port or userinfo.
pub fn normalize_domain(raw: &str) -> Result<String, ContractError> {
    let domain = raw.to_ascii_lowercase();
    if valid_hostname(&domain) {
        Ok(domain)
    } else {
        Err(ContractError::InvalidDomain)
    }
}

/// Validate and deduplicate the allow list, preserving first-seen order.
pub fn normalize_emails(raw: &[String]) -> Result<Vec<String>, ContractError> {
    if raw.is_empty() {
        return Err(ContractError::NoAllowedEmail);
    }
    let mut out: Vec<String> = Vec::new();
    for item in raw {
        let email = normalize_email(item)?;
        if !out.contains(&email) {
            out.push(email);
        }
    }
    if out.len() > MAX_ALLOWED_EMAILS {
        return Err(ContractError::TooManyEmails);
    }
    Ok(out)
}

impl ConnectionConfig {
    /// Validate the config and return its canonical form.
    ///
    /// A disabled config may have an empty allow list. An enabled one may not:
    /// "any Google account" is never allowed.
    pub fn validated(&self) -> Result<Self, ContractError> {
        let allow_emails = if self.enabled || !self.allow_emails.is_empty() {
            normalize_emails(&self.allow_emails)?
        } else {
            Vec::new()
        };
        let domain = self
            .domain
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .map(normalize_domain)
            .transpose()?;
        Ok(Self {
            enabled: self.enabled,
            allow_emails,
            domain,
            oauth_app: self.oauth_app,
            revision: self.revision,
        })
    }
}

mod access;
mod endpoint;
mod policy;

pub use access::{PublicOrigin, TunnelProof};
pub use endpoint::{EndpointError, OpenEndpoint, open_endpoint};
pub use policy::{PolicyOauth, build_traffic_policy};

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderName, HeaderValue};
    use serde_json::{Value, json};
    use url::Url;

    fn proof() -> TunnelProof {
        TunnelProof::from_bytes(&[7u8; 32])
    }

    fn emails(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn status_and_config_serialize_to_the_contract_names() {
        let names: Vec<String> = [
            ConnectionStatus::Disabled,
            ConnectionStatus::NeedsConfig,
            ConnectionStatus::Starting,
            ConnectionStatus::Ready,
            ConnectionStatus::Reconnecting,
            ConnectionStatus::Failed,
            ConnectionStatus::Stopping,
        ]
        .iter()
        .map(|s| {
            serde_json::to_value(s)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
        assert_eq!(
            names,
            [
                "disabled",
                "needs_config",
                "starting",
                "ready",
                "reconnecting",
                "failed",
                "stopping"
            ]
        );
        let v = serde_json::to_value(ConnectionConfig::default()).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(
            keys,
            ["allowEmails", "domain", "enabled", "oauthApp", "revision"]
        );
        assert!(
            serde_json::from_str::<ConnectionConfig>(
                r#"{"enabled":false,"allowEmails":[],"domain":null,"oauthApp":"managed","revision":0,"deviceStore":1}"#
            )
            .is_err()
        );
    }

    #[test]
    fn emails_are_validated_and_canonicalized() {
        assert_eq!(
            normalize_email("Owner@Example.COM").unwrap(),
            "owner@example.com"
        );
        for bad in [
            "",
            "a",
            "@x.com",
            "a@",
            "a@b",
            "a@@b.com",
            "a b@x.com",
            "a'b@x.com",
            "a\"b@x.com",
            "a\\b@x.com",
            "a@x.com\n",
            "a\u{0}@x.com",
            "a@x.com,b@x.com",
            "a@-x.com",
            "日本@x.com",
            "a@x..com",
        ] {
            assert_eq!(
                normalize_email(bad),
                Err(ContractError::InvalidEmail),
                "{bad:?}"
            );
        }
        assert_eq!(normalize_emails(&[]), Err(ContractError::NoAllowedEmail));
        assert_eq!(
            normalize_emails(&emails(&["A@x.com", "a@x.com", "b@x.com"])).unwrap(),
            ["a@x.com", "b@x.com"]
        );
        let many: Vec<String> = (0..=MAX_ALLOWED_EMAILS)
            .map(|i| format!("u{i}@x.com"))
            .collect();
        assert_eq!(normalize_emails(&many), Err(ContractError::TooManyEmails));
    }

    #[test]
    fn domains_are_bare_hosts() {
        assert_eq!(
            normalize_domain("Example.ngrok.app").unwrap(),
            "example.ngrok.app"
        );
        for bad in [
            "https://a.ngrok.app",
            "a.ngrok.app/x",
            "a.ngrok.app:443",
            "u@a.ngrok.app",
            "localhost",
            "",
            "a b.com",
        ] {
            assert_eq!(
                normalize_domain(bad),
                Err(ContractError::InvalidDomain),
                "{bad}"
            );
        }
    }

    #[test]
    fn enabled_config_needs_an_allow_list() {
        let mut c = ConnectionConfig {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(c.validated(), Err(ContractError::NoAllowedEmail));
        c.allow_emails = emails(&["Me@x.com"]);
        c.domain = Some(" ".into());
        let v = c.validated().unwrap();
        assert_eq!(v.allow_emails, ["me@x.com"]);
        assert_eq!(v.domain, None);
        assert!(ConnectionConfig::default().validated().is_ok());
    }

    #[test]
    fn policy_snapshot_has_deny_by_default_order() {
        let p = build_traffic_policy(
            &emails(&["owner@example.com", "b@x.org"]),
            &proof(),
            &PolicyOauth::Managed,
        )
        .unwrap();
        let expected = json!({
            "on_http_request": [
                {"actions": [{"type": "oauth", "config": {"provider": "google"}}]},
                {
                    "expressions": ["!(actions.ngrok.oauth.identity.email in [\"owner@example.com\",\"b@x.org\"])"],
                    "actions": [{"type": "deny", "config": {"status_code": 403}}]
                },
                {"actions": [{"type": "remove-headers", "config": {"headers": ["x-agboard-tunnel-proof"]}}]},
                {"actions": [{"type": "add-headers", "config": {"headers": {
                    "x-agboard-tunnel-proof": "07".repeat(32)
                }}}]}
            ]
        });
        assert_eq!(serde_json::from_str::<Value>(&p).unwrap(), expected);
        // Remove Headers must come before Add Headers, and auth before both.
        let pos = |needle: &str| p.find(needle).unwrap();
        assert!(pos("\"oauth\"") < pos("\"deny\""));
        assert!(pos("\"deny\"") < pos("\"remove-headers\""));
        assert!(pos("\"remove-headers\"") < pos("\"add-headers\""));
    }

    #[test]
    fn policy_refuses_unsafe_or_empty_allow_lists() {
        for bad in [
            emails(&[]),
            emails(&["a'] || true || ['b@x.com"]),
            emails(&["a\"@x.com"]),
        ] {
            assert!(build_traffic_policy(&bad, &proof(), &PolicyOauth::Managed).is_err());
        }
    }

    #[test]
    fn custom_oauth_needs_both_values_and_is_redacted() {
        let custom = |id: &str, s: &str| PolicyOauth::Custom {
            client_id: id.into(),
            client_secret: s.into(),
        };
        let e = emails(&["a@x.com"]);
        assert_eq!(
            build_traffic_policy(&e, &proof(), &custom("id", "")),
            Err(ContractError::MissingOauthCredentials)
        );
        let p = build_traffic_policy(&e, &proof(), &custom("id", "s3cret")).unwrap();
        assert!(p.contains("\"client_id\":\"id\""));
        assert!(!format!("{:?}", custom("id", "s3cret")).contains("s3cret"));
        assert!(!format!("{:?}", proof()).contains("0707"));
    }

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
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
    fn proof_must_be_present_single_and_equal() {
        let p = proof();
        let good = "07".repeat(32);
        assert_eq!(
            p.verify(&headers(&[("x-agboard-tunnel-proof", &good)])),
            Ok(())
        );
        assert_eq!(p.verify(&headers(&[])), Err(ContractError::ProofMissing));
        assert_eq!(
            p.verify(&headers(&[
                ("x-agboard-tunnel-proof", &good),
                ("X-Agboard-Tunnel-Proof", &good)
            ])),
            Err(ContractError::ProofDuplicate)
        );
        for bad in ["", "07", &"08".repeat(32), &format!("{good}0")] {
            assert_eq!(
                p.verify(&headers(&[("x-agboard-tunnel-proof", bad)])),
                Err(ContractError::ProofMismatch),
                "{bad}"
            );
        }
    }

    #[test]
    fn generated_proofs_are_256_bit_and_unique() {
        let a = TunnelProof::generate().unwrap();
        let b = TunnelProof::generate().unwrap();
        assert_eq!(a.expose().len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn public_origin_accepts_only_a_bare_https_origin() {
        let o = PublicOrigin::parse("https://Abc.ngrok.app").unwrap();
        assert_eq!(o.origin(), "https://abc.ngrok.app");
        assert_eq!(o.authority(), "abc.ngrok.app");
        for bad in [
            "http://a.ngrok.app",
            "https://u:p@a.ngrok.app",
            "https://a.ngrok.app/x",
            "https://a.ngrok.app/?q=1",
            "https://a.ngrok.app/#f",
            "a.ngrok.app",
            "",
        ] {
            assert_eq!(
                PublicOrigin::parse(bad),
                Err(ContractError::InvalidPublicUrl),
                "{bad}"
            );
        }
    }

    #[test]
    fn host_and_origin_must_equal_the_public_values() {
        let o = PublicOrigin::parse("https://abc.ngrok.app").unwrap();
        assert_eq!(o.check_host(&headers(&[("host", "abc.ngrok.app")])), Ok(()));
        for bad in [
            headers(&[]),
            headers(&[("host", "localhost:7420")]),
            headers(&[("host", "abc.ngrok.app:443")]),
            headers(&[("host", "abc.ngrok.app"), ("host", "abc.ngrok.app")]),
        ] {
            assert_eq!(o.check_host(&bad), Err(ContractError::HostMismatch));
        }
        assert_eq!(
            o.check_origin(&headers(&[("origin", "https://abc.ngrok.app")])),
            Ok(())
        );
        for bad in [
            headers(&[]),
            headers(&[("origin", "null")]),
            headers(&[("origin", "http://abc.ngrok.app")]),
            headers(&[("origin", "https://abc.ngrok.app.evil.com")]),
            headers(&[("origin", "https://abc.ngrok.app/")]),
        ] {
            assert_eq!(o.check_origin(&bad), Err(ContractError::OriginMismatch));
        }
    }

    /// Links the SDK and drives it on the test Tokio runtime. Connecting to a
    /// closed loopback port fails locally, so this never reaches the network and
    /// proves nothing about a real ngrok connection.
    #[tokio::test]
    async fn sdk_builds_a_session_on_the_shared_runtime() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        drop(listener);
        let result = open_endpoint(
            "test-token",
            "{}",
            Url::parse("http://127.0.0.1:1").unwrap(),
            None,
            Some(&addr),
        )
        .await;
        match result {
            Err(EndpointError::Connect(msg)) => assert!(!msg.contains("test-token")),
            Err(other) => panic!("unexpected error: {other}"),
            Ok(_) => panic!("must not connect to a closed port"),
        }
    }
}
