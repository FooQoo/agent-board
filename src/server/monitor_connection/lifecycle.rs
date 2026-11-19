//! The supervisor of the ngrok connection: what is saved, what is in memory,
//! and the start, change and stop transitions.
//!
//! Secrets (the ngrok token and the phone passcode) live in memory
//! only and are never written to disk, logged or put in an error message. The
//! passcode alone is shown to the PC, in a snapshot, while the connection is ready.
//! Methods that start something must run inside the server's Tokio runtime.

use std::sync::{Arc, Mutex};

use super::config::{ConfigError, ConfigStore};
use super::contracts::{ConnectionConfig, ConnectionStatus};
use super::keychain::TokenVault;
use super::run::Run;
pub use super::types::*;
use crate::server::monitor_auth::passcode::Passcode;

pub(super) struct Inner {
    pub(super) config: ConnectionConfig,
    pub(super) status: ConnectionStatus,
    pub(super) url: Option<String>,
    pub(super) failure: Option<FailureCode>,
    pub(super) token: Option<Secret>,
    pub(super) token_source: Option<TokenSource>,
    /// Whether the keychain holds a token; `None` until it was first looked at.
    pub(super) keychain_saved: Option<bool>,
    /// Whether the keychain is being read in the background; nobody else
    /// reads it until that read is done.
    pub(super) probing: bool,
    pub(super) generation: u64,
    pub(super) run: Option<Run>,
    /// The passcode of the running connection; set once it is ready.
    pub(super) passcode: Option<Passcode>,
}

pub struct MonitorConnections {
    pub(super) store: ConfigStore,
    pub(super) connector: Arc<dyn Connector>,
    pub(super) vault: Arc<dyn TokenVault>,
    /// The server's state, given once it exists; the monitor routes read it.
    pub(super) app: std::sync::OnceLock<std::sync::Weak<crate::server::AppState>>,
    pub(super) inner: Mutex<Inner>,
    /// The ngrok domain the endpoint is requested on, from the environment.
    pub(super) domain: Option<String>,
    /// Woken when a keychain read finishes, for those waiting on it.
    pub(super) probed: tokio::sync::Notify,
}

impl MonitorConnections {
    /// Read the saved settings. An unreadable file leaves the defaults and a
    /// `config_unreadable` failure; the PC can save new settings over it.
    pub fn new(
        store: ConfigStore,
        connector: Arc<dyn Connector>,
        vault: Arc<dyn TokenVault>,
        env: MonitorEnv,
    ) -> Arc<Self> {
        let (config, failure) = match store.load() {
            Ok(config) => (config, None),
            Err(_) => (
                ConnectionConfig::default(),
                Some(FailureCode::ConfigUnreadable),
            ),
        };
        let status = if failure.is_some() {
            ConnectionStatus::Failed
        } else {
            idle_status(&config, env.token.is_some())
        };
        Arc::new(Self {
            store,
            connector,
            vault,
            app: std::sync::OnceLock::new(),
            domain: env.domain.clone(),
            inner: Mutex::new(Inner {
                config,
                status,
                url: None,
                failure,
                token_source: env.token.is_some().then_some(TokenSource::Env),
                token: env.token,
                keychain_saved: None,
                probing: false,
                generation: 0,
                run: None,
                passcode: None,
            }),
            probed: tokio::sync::Notify::new(),
        })
    }

    /// Give the supervisor the server's state. Called once, before any start.
    pub(crate) fn attach(&self, app: &Arc<crate::server::AppState>) {
        let _ = self.app.set(Arc::downgrade(app));
    }

    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Startup. When `explicit` (`--monitor ngrok`), start now and wait for the
    /// result so that a failure can end the process; otherwise restore a saved
    /// enabled setting in the background, or wait for the PC when no token is held.
    pub async fn startup(
        self: &Arc<Self>,
        explicit: bool,
    ) -> Result<Option<MonitorReady>, FailureCode> {
        let waiting = {
            let mut inner = self.lock();
            if explicit {
                inner.config.enabled = true;
                inner.failure = None;
                Some(self.begin(&mut inner).map_err(|e| failure_of(&e))?)
            } else {
                if inner.config.enabled && inner.failure.is_none() {
                    if inner.token.is_some() {
                        // A token is already held: nothing to read.
                        self.restore(&mut inner);
                    } else {
                        // The keychain may stop to ask the user, so it is read
                        // in the background and startup does not wait for it.
                        self.restore_from_keychain(&mut inner);
                    }
                }
                None
            }
        };
        match waiting {
            Some(rx) => match rx.await {
                Ok(Ok(ready)) => Ok(Some(ready)),
                Ok(Err(code)) => Err(code),
                Err(_) => Err(FailureCode::Internal),
            },
            None => Ok(None),
        }
    }

    /// Save new settings. Nothing changes unless the save succeeds.
    pub fn update(self: &Arc<Self>, update: SettingsUpdate) -> Result<Snapshot, UpdateError> {
        let mut inner = self.lock();
        if update.revision != inner.config.revision {
            return Err(UpdateError::Conflict);
        }
        let candidate = ConnectionConfig {
            enabled: update.enabled,
            revision: inner.config.revision + 1,
            domain: match update.domain {
                Some(domain) => domain,
                None => inner.config.domain.clone(),
            },
        };
        self.store
            .save(&candidate)
            .map_err(|_: ConfigError| UpdateError::SaveFailed)?;
        inner.config = candidate;
        if inner.failure == Some(FailureCode::ConfigUnreadable) {
            inner.failure = None;
        }
        let active = inner.run.is_some()
            && matches!(
                inner.status,
                ConnectionStatus::Starting
                    | ConnectionStatus::Ready
                    | ConnectionStatus::Reconnecting
            );
        if active && !inner.config.enabled {
            self.teardown(&mut inner);
        } else if inner.run.is_none() && inner.failure.is_none() {
            inner.status = idle_status(&inner.config, inner.token.is_some());
        }
        Ok(self.snapshot_now(&inner))
    }

    /// Start the connection. The domain a run uses is `AGBOARD_NGROK_DOMAIN` when set, else the
    /// saved one. `token`, if given, replaces the one held in memory.
    /// With `save`, that token is also put in the OS keychain; if the keychain
    /// cannot take it nothing is started and nothing is changed. A start is an
    /// explicit request to stay on, so a disabled setting is saved as enabled
    /// first; nothing starts if that save fails.
    /// The keychain is read and written without holding the lock, so only
    /// this request waits if the keychain stops to ask the user.
    pub async fn start(
        self: &Arc<Self>,
        token: Option<Secret>,
        save: bool,
    ) -> Result<Snapshot, StartError> {
        if self.lock().failure == Some(FailureCode::ConfigUnreadable) {
            return Err(StartError::SettingsUnreadable);
        }
        self.probed().await;
        if save && let Some(token) = &token {
            let vault = self.vault.clone();
            let token = token.clone();
            tokio::task::spawn_blocking(move || vault.save(&token))
                .await
                .unwrap_or(Err(super::keychain::VaultError::Failed))
                .map_err(|_| StartError::KeychainUnavailable)?;
        }
        let mut inner = self.lock();
        if inner.failure == Some(FailureCode::ConfigUnreadable) {
            return Err(StartError::SettingsUnreadable);
        }
        if save && token.is_some() {
            inner.keychain_saved = Some(true);
        }
        if let Some(token) = token {
            inner.token = Some(token);
            inner.token_source = Some(if save {
                TokenSource::Keychain
            } else {
                TokenSource::Session
            });
        }
        if inner.token.is_none() {
            return Err(StartError::TokenRequired);
        }
        if !inner.config.enabled {
            let next = ConnectionConfig {
                enabled: true,
                revision: inner.config.revision + 1,
                domain: inner.config.domain.clone(),
            };
            self.store.save(&next).map_err(|_| StartError::SaveFailed)?;
            inner.config = next;
        }
        // The receiver is dropped: the caller polls the status instead.
        drop(self.begin(&mut inner)?);
        Ok(self.snapshot_now(&inner))
    }

    /// Stop the connection, forget any pending start, and save `enabled: false`.
    pub fn stop(self: &Arc<Self>) -> Snapshot {
        let mut inner = self.lock();
        self.teardown(&mut inner);
        if inner.config.enabled {
            let mut next = inner.config.clone();
            next.enabled = false;
            next.revision += 1;
            if self.store.save(&next).is_ok() {
                inner.config = next;
            }
        }
        inner.status = idle_status(&inner.config, inner.token.is_some());
        self.snapshot_now(&inner)
    }

    /// Whether the connection is up or on its way up: the server is in use for as long as it is.
    pub(crate) fn is_active(&self) -> bool {
        matches!(
            self.lock().status,
            ConnectionStatus::Starting
                | ConnectionStatus::Ready
                | ConnectionStatus::Reconnecting
                | ConnectionStatus::Stopping
        )
    }

    /// Close everything without touching the saved settings (server exit, rollback).
    pub fn shutdown(&self) {
        let mut inner = self.lock();
        self.teardown(&mut inner);
        inner.status = ConnectionStatus::Disabled;
    }

    pub(super) fn teardown(&self, inner: &mut Inner) {
        inner.generation += 1;
        if let Some(run) = inner.run.take() {
            run.close();
        }
        inner.passcode = None;
        inner.url = None;
        inner.failure = None;
        inner.status = ConnectionStatus::Disabled;
    }
}

pub(super) fn idle_status(config: &ConnectionConfig, has_token: bool) -> ConnectionStatus {
    if config.enabled && !has_token {
        ConnectionStatus::NeedsConfig
    } else {
        ConnectionStatus::Disabled
    }
}

/// The fixed failure reason for a start that could not begin.
pub(super) fn failure_of(error: &StartError) -> FailureCode {
    match error {
        StartError::TokenRequired => FailureCode::ConfigInvalid,
        _ => FailureCode::Internal,
    }
}
