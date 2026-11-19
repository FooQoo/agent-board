//! Contracts for the built-in ngrok monitor connection: configuration and status
//! types, public Origin/Host checks, and the SDK entry point.
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
    pub revision: u64,
    /// The ngrok domain to open the endpoint on, so the address stays the same.
    /// `None` lets ngrok choose a new address at every start.
    #[serde(default)]
    pub domain: Option<String>,
}

/// Why an input or request was refused. Messages never include secret values.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ContractError {
    #[error("the public URL must be a plain https origin")]
    InvalidPublicUrl,
    #[error("the Host header does not match the public origin")]
    HostMismatch,
    #[error("the Origin header does not match the public origin")]
    OriginMismatch,
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
    fn a_result_link_names_the_project_task_and_version_in_the_query() {
        let origin = PublicOrigin::parse("https://abc.ngrok-free.app").unwrap();
        let project = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            origin.result_link(project, 12, 3).as_deref(),
            Some(
                "https://abc.ngrok-free.app/?project=0123456789abcdef0123456789abcdef&task=12&result=3"
            )
        );
        assert_eq!(origin.result_link("nope", 12, 3), None);
        assert_eq!(origin.result_link(&project.to_uppercase(), 12, 3), None);
        assert_eq!(origin.result_link(project, 0, 3), None);
        assert_eq!(origin.result_link(project, 12, 0), None);
        assert_eq!(origin.result_link(project, 9_007_199_254_740_992, 1), None);
        assert!(origin.result_link(project, 10_000_000_000, 1).is_some());
    }

    #[test]
    fn a_history_link_names_the_project_and_task_and_the_history_tab() {
        let origin = PublicOrigin::parse("https://abc.ngrok-free.app").unwrap();
        let project = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            origin.history_link(project, 12).as_deref(),
            Some(
                "https://abc.ngrok-free.app/?project=0123456789abcdef0123456789abcdef&task=12&tab=history"
            )
        );
        assert_eq!(origin.history_link("nope", 12), None);
        assert_eq!(origin.history_link(&project.to_uppercase(), 12), None);
        assert_eq!(origin.history_link(project, 0), None);
        assert_eq!(origin.history_link(project, 9_007_199_254_740_992), None);
    }

    #[test]
    fn a_question_link_names_the_task_and_the_question() {
        let origin = PublicOrigin::parse("https://abc.ngrok-free.app").unwrap();
        let project = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            origin.question_link(project, 12, "Q-7").as_deref(),
            Some(
                "https://abc.ngrok-free.app/?project=0123456789abcdef0123456789abcdef&task=12&question=Q-7"
            )
        );
        for bad in [
            "",
            "Q-",
            "Q-0",
            "Q-07",
            "q-7",
            "Q-7&x=1",
            "Q-a",
            "7",
            "Q-12345678901234567",
        ] {
            assert_eq!(origin.question_link(project, 12, bad), None, "{bad}");
        }
        assert_eq!(origin.question_link("nope", 12, "Q-7"), None);
        assert_eq!(origin.question_link(project, 0, "Q-7"), None);
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
        assert_eq!(keys, ["domain", "enabled", "revision"]);
        // Only the enabled flag, the revision and the domain are settings: a file with any other field is not read.
        for stale in [
            r#"{"enabled":false,"revision":0,"allowEmails":[]}"#,
            r#"{"enabled":false,"revision":0,"oauthApp":"managed"}"#,
            r#"{"enabled":false,"revision":0,"deviceStore":1}"#,
        ] {
            assert!(serde_json::from_str::<ConnectionConfig>(stale).is_err());
        }
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
