//! Plain types of the ngrok connection: secrets, environment, connector
//! interface, the API snapshot and the error enums.

use std::any::Any;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;
use url::Url;

use super::contracts::{
    ConnectionStatus, ContractError, EndpointError, OauthApp, PublicOrigin, open_endpoint,
};

/// A value that must never be printed.
#[derive(Clone)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

/// Values taken from the process environment at startup.
#[derive(Clone, Default)]
pub struct MonitorEnv {
    /// `NGROK_AUTHTOKEN`.
    pub token: Option<Secret>,
    /// `AGBOARD_GOOGLE_CLIENT_ID` and `AGBOARD_GOOGLE_CLIENT_SECRET`, both present.
    pub google: Option<(Secret, Secret)>,
}

impl MonitorEnv {
    pub fn from_process() -> Self {
        let get = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        Self {
            token: get("NGROK_AUTHTOKEN").map(Secret::new),
            google: get("AGBOARD_GOOGLE_CLIENT_ID")
                .zip(get("AGBOARD_GOOGLE_CLIENT_SECRET"))
                .map(|(id, secret)| (Secret::new(id), Secret::new(secret))),
        }
    }
}

/// Settings given on the command line; they win over the saved ones for this run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Overrides {
    pub allow_emails: Vec<String>,
    pub domain: Option<String>,
    pub oauth_app: Option<OauthApp>,
}

/// Short, fixed reasons a start can fail. Safe to show and to log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    ConnectFailed,
    EndpointFailed,
    PublicUrlInvalid,
    Internal,
    ConfigUnreadable,
}

impl FailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ConnectFailed => "connect_failed",
            Self::EndpointFailed => "endpoint_failed",
            Self::PublicUrlInvalid => "public_url_invalid",
            Self::Internal => "internal",
            Self::ConfigUnreadable => "config_unreadable",
        }
    }
}

/// What the connector needs. `token` and `policy` are secrets.
pub struct OpenRequest {
    pub token: Secret,
    pub policy: Secret,
    pub backend: Url,
    pub domain: Option<String>,
}

/// An open tunnel. Dropping `keep_alive` closes it.
pub struct OpenedTunnel {
    pub public: PublicOrigin,
    pub keep_alive: Box<dyn Any + Send>,
}

#[derive(Debug)]
pub struct OpenFailure {
    pub code: FailureCode,
}

pub type OpenFuture = Pin<Box<dyn Future<Output = Result<OpenedTunnel, OpenFailure>> + Send>>;

/// Opens the public endpoint. The real one uses the ngrok SDK; tests use a fake
/// so that nothing reaches the network.
pub trait Connector: Send + Sync {
    fn open(&self, request: OpenRequest) -> OpenFuture;
}

pub struct SdkConnector;

impl Connector for SdkConnector {
    fn open(&self, request: OpenRequest) -> OpenFuture {
        Box::pin(async move {
            let endpoint = open_endpoint(
                request.token.expose(),
                request.policy.expose(),
                request.backend,
                request.domain.as_deref(),
                None,
            )
            .await
            .map_err(|e| OpenFailure {
                code: match e {
                    EndpointError::Connect(_) => FailureCode::ConnectFailed,
                    EndpointError::Listen(_) => FailureCode::EndpointFailed,
                    EndpointError::PublicUrl => FailureCode::PublicUrlInvalid,
                },
            })?;
            Ok(OpenedTunnel {
                public: endpoint.public.clone(),
                keep_alive: Box::new(endpoint),
            })
        })
    }
}

/// How the built-in ngrok monitor connection is set up for one run.
#[derive(Clone)]
pub struct MonitorOptions {
    /// Values from the process environment (token, Google app).
    pub env: MonitorEnv,
    /// Settings from the command line. When present the run must start the
    /// connection before it announces itself and fails if it cannot.
    pub explicit: Option<Overrides>,
    /// Opens the public endpoint. Tests replace it so nothing reaches the network.
    pub connector: Arc<dyn Connector>,
}

impl MonitorOptions {
    /// Real SDK connector and the given environment.
    pub fn new(env: MonitorEnv, explicit: Option<Overrides>) -> Self {
        Self {
            env,
            explicit,
            connector: Arc::new(SdkConnector),
        }
    }
}

/// What a monitor started on the command line reports once it is ready.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorReady {
    pub url: String,
}

/// What `GET /api/monitor-connections` returns: nothing secret.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub mode: &'static str,
    pub status: ConnectionStatus,
    pub url: Option<String>,
    pub revision: u64,
    pub settings: Settings,
    pub token_configured: bool,
    pub failure: Option<FailureCode>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub allow_emails: Vec<String>,
    pub domain: Option<String>,
    pub oauth_app: OauthApp,
}

/// A settings change from the PC. `revision` is the one the PC last saw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub enabled: bool,
    pub allow_emails: Vec<String>,
    pub domain: Option<String>,
    pub oauth_app: OauthApp,
    pub revision: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    Conflict,
    Invalid(ContractError),
    SaveFailed,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StartError {
    /// No ngrok token is held and none was given.
    TokenRequired,
    Invalid(ContractError),
    Internal,
}
