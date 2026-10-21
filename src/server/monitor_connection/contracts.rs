//! Contracts for the built-in ngrok monitor connection: configuration and status
//! types, input validation, public Origin/Host checks, and the SDK entry point.
//! The endpoint is opened without a Traffic Policy.
//!
//! Nothing here starts a tunnel on its own. The HTTP stack that serves the
//! monitor builds on these types.

use serde::{Deserialize, Serialize};
use thiserror::Error;

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
    pub domain: Option<String>,
    pub revision: u64,
}

/// Why an input or request was refused. Messages never include secret values.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ContractError {
    #[error("invalid domain")]
    InvalidDomain,
    #[error("the public URL must be a plain https origin")]
    InvalidPublicUrl,
    #[error("the Host header does not match the public origin")]
    HostMismatch,
    #[error("the Origin header does not match the public origin")]
    OriginMismatch,
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

impl ConnectionConfig {
    /// Validate the config and return its canonical form. A blank domain means
    /// "let ngrok choose one".
    pub fn validated(&self) -> Result<Self, ContractError> {
        let domain = self
            .domain
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .map(normalize_domain)
            .transpose()?;
        Ok(Self {
            enabled: self.enabled,
            domain,
            revision: self.revision,
        })
    }
}

mod access;
mod endpoint;

pub use access::PublicOrigin;
pub use endpoint::{EndpointError, OpenEndpoint, open_endpoint};

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderName, HeaderValue};
    use url::Url;

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
        assert_eq!(keys, ["domain", "enabled", "revision"]);
        // The Google settings are gone: a saved file that still has them is not read.
        for stale in [
            r#"{"enabled":false,"domain":null,"revision":0,"allowEmails":[]}"#,
            r#"{"enabled":false,"domain":null,"revision":0,"oauthApp":"managed"}"#,
            r#"{"enabled":false,"domain":null,"revision":0,"deviceStore":1}"#,
        ] {
            assert!(serde_json::from_str::<ConnectionConfig>(stale).is_err());
        }
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
    fn an_enabled_config_needs_nothing_but_a_valid_or_blank_domain() {
        let mut c = ConnectionConfig {
            enabled: true,
            ..Default::default()
        };
        assert_eq!(c.validated().unwrap().domain, None);
        c.domain = Some(" ".into());
        assert_eq!(c.validated().unwrap().domain, None);
        c.domain = Some("Me.Ngrok.App".into());
        assert_eq!(
            c.validated().unwrap().domain.as_deref(),
            Some("me.ngrok.app")
        );
        c.domain = Some("not a host".into());
        assert_eq!(c.validated(), Err(ContractError::InvalidDomain));
        assert!(ConnectionConfig::default().validated().is_ok());
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
