//! Plain types of the ngrok connection: secrets, environment, connector
//! interface, the API snapshot and the error enums.

use std::any::Any;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;
use url::Url;

use super::contracts::{ConnectionStatus, EndpointError, PublicOrigin, open_endpoint};
use super::keychain::{NoKeychain, OsKeychain, TokenVault};
use crate::server::monitor_auth::passcode::Passcode;

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
}

impl MonitorEnv {
    pub fn from_process() -> Self {
        let get = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        Self {
            token: get("NGROK_AUTHTOKEN").map(Secret::new),
        }
    }
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
    ConfigInvalid,
}

impl FailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ConnectFailed => "connect_failed",
            Self::EndpointFailed => "endpoint_failed",
            Self::PublicUrlInvalid => "public_url_invalid",
            Self::Internal => "internal",
            Self::ConfigUnreadable => "config_unreadable",
            Self::ConfigInvalid => "config_invalid",
        }
    }
}

/// What the connector needs. `token` is a secret. There is no Traffic Policy and no
/// domain to send: ngrok chooses the public address.
pub struct OpenRequest {
    pub token: Secret,
    pub backend: Url,
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
            let endpoint = open_endpoint(request.token.expose(), request.backend, None)
                .await
                .map_err(|e| {
                    // Diagnostic only: the reason ngrok gave. The error text never holds the token.
                    eprintln!("agboard: ngrok did not open the tunnel: {e}");
                    OpenFailure {
                        code: match e {
                            EndpointError::Connect(_) => FailureCode::ConnectFailed,
                            EndpointError::Listen(_) => FailureCode::EndpointFailed,
                            EndpointError::PublicUrl => FailureCode::PublicUrlInvalid,
                        },
                    }
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
    /// Values from the process environment (the ngrok token).
    pub env: MonitorEnv,
    /// `--monitor ngrok` was given on the command line. The run must then start the
    /// connection before it announces itself and fails if it cannot.
    pub explicit: bool,
    /// Opens the public endpoint. Tests replace it so nothing reaches the network.
    pub connector: Arc<dyn Connector>,
    /// Where a saved token lives. Tests replace it so the real keychain is untouched.
    pub vault: Arc<dyn TokenVault>,
}

impl MonitorOptions {
    /// Real SDK connector, the OS keychain and the given environment.
    pub fn new(env: MonitorEnv, explicit: bool) -> Self {
        Self {
            env,
            explicit,
            connector: Arc::new(SdkConnector),
            vault: Arc::new(OsKeychain),
        }
    }

    /// Like [`MonitorOptions::new`] but with no keychain: nothing is read or saved.
    pub fn without_keychain(env: MonitorEnv, explicit: bool) -> Self {
        Self {
            vault: Arc::new(NoKeychain),
            ..Self::new(env, explicit)
        }
    }
}

/// What a monitor started on the command line reports once it is ready: the
/// public URL and the passcode of this start, for the PC to show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonitorReady {
    pub url: String,
    pub passcode: Passcode,
}

/// What `GET /api/monitor-connections` returns: nothing secret.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: ConnectionStatus,
    pub url: Option<String>,
    pub revision: u64,
    pub settings: Settings,
    pub token_configured: bool,
    /// Which token a start would use; `None` when there is none. Never the value.
    pub token_source: Option<TokenSource>,
    /// Whether a token can be saved in the OS keychain here.
    pub keychain_available: bool,
    /// Whether a token is saved in the keychain (even if another one wins).
    pub keychain_token_saved: bool,
    pub failure: Option<FailureCode>,
    /// The passcode of the running connection, for the PC to show. Present only
    /// while the status is `ready`; a stopped or failed connection has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passcode: Option<Passcode>,
}

/// Where the token in use came from.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TokenSource {
    /// `NGROK_AUTHTOKEN`.
    Env,
    /// The OS keychain.
    Keychain,
    /// Typed on the PC for this run only.
    Session,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
}

/// A settings change from the PC. `revision` is the one the PC last saw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub enabled: bool,
    pub revision: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    Conflict,
    SaveFailed,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StartError {
    /// No ngrok token is held and none was given.
    TokenRequired,
    /// The saved settings file could not be read; save the settings first.
    SettingsUnreadable,
    /// The enabled setting could not be saved, so nothing was started.
    SaveFailed,
    /// Saving the token was asked for but the keychain cannot take it; nothing was started.
    KeychainUnavailable,
    Internal,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ForgetError {
    /// The keychain is not usable, so the saved token cannot be removed.
    KeychainUnavailable,
}
