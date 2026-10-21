//! The supervisor of the ngrok connection: what is saved, what is in memory,
//! and the start, change and stop transitions.
//!
//! Secrets (the ngrok token, the Google client secret, the tunnel proof) live in
//! memory only and are never part of a snapshot, a log line or an error message.
//! Methods that start something must run inside the server's Tokio runtime.

use std::sync::{Arc, Mutex};

use super::config::{ConfigError, ConfigStore};
use super::contracts::{ConnectionConfig, ConnectionStatus, ContractError, OauthApp};
use super::keychain::TokenVault;
use super::run::Run;
pub use super::types::*;

pub(super) struct Inner {
    pub(super) config: ConnectionConfig,
    pub(super) status: ConnectionStatus,
    pub(super) url: Option<String>,
    pub(super) failure: Option<FailureCode>,
    pub(super) token: Option<Secret>,
    pub(super) token_source: Option<TokenSource>,
    /// Whether the keychain holds a token; `None` until it was first looked at.
    pub(super) keychain_saved: Option<bool>,
    pub(super) generation: u64,
    pub(super) run: Option<Run>,
}

pub struct MonitorConnections {
    pub(super) store: ConfigStore,
    pub(super) connector: Arc<dyn Connector>,
    pub(super) vault: Arc<dyn TokenVault>,
    pub(super) google: Option<(Secret, Secret)>,
    /// The server's state, given once it exists; the monitor routes read it.
    pub(super) app: std::sync::OnceLock<std::sync::Weak<crate::server::AppState>>,
    pub(super) inner: Mutex<Inner>,
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
            google: env.google,
            app: std::sync::OnceLock::new(),
            inner: Mutex::new(Inner {
                config,
                status,
                url: None,
                failure,
                token_source: env.token.is_some().then_some(TokenSource::Env),
                token: env.token,
                keychain_saved: None,
                generation: 0,
                run: None,
            }),
        })
    }

    /// Give the supervisor the server's state. Called once, before any start.
    pub(crate) fn attach(&self, app: &Arc<crate::server::AppState>) {
        let _ = self.app.set(Arc::downgrade(app));
    }

    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Startup. With `explicit` settings, start now and wait for the result so
    /// that a failure can end the process; otherwise restore a saved enabled
    /// setting in the background, or wait for the PC when no token is held.
    pub async fn startup(
        self: &Arc<Self>,
        explicit: Option<Overrides>,
    ) -> Result<Option<String>, FailureCode> {
        let waiting = {
            let mut inner = self.lock();
            if let Some(over) = explicit {
                inner.config.enabled = true;
                inner.config.allow_emails = over.allow_emails;
                if over.domain.is_some() {
                    inner.config.domain = over.domain;
                }
                if let Some(app) = over.oauth_app {
                    inner.config.oauth_app = app;
                }
                inner.failure = None;
                Some(self.begin(&mut inner).map_err(|e| failure_of(&e))?)
            } else {
                if inner.config.enabled && inner.failure.is_none() {
                    self.probe_keychain(&mut inner);
                    if inner.token.is_some() {
                        // Restoring: a failure is shown on the PC, not fatal.
                        if let Err(e) = self.begin(&mut inner) {
                            inner.status = ConnectionStatus::Failed;
                            inner.failure = Some(failure_of(&e));
                        }
                    } else {
                        inner.status = ConnectionStatus::NeedsConfig;
                    }
                }
                None
            }
        };
        match waiting {
            Some(rx) => match rx.await {
                Ok(Ok(url)) => Ok(Some(url)),
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
            allow_emails: update.allow_emails,
            domain: update.domain,
            oauth_app: update.oauth_app,
            revision: inner.config.revision + 1,
        }
        .validated()
        .map_err(UpdateError::Invalid)?;
        self.store
            .save(&candidate)
            .map_err(|_: ConfigError| UpdateError::SaveFailed)?;
        let changed = {
            let old = &inner.config;
            old.allow_emails != candidate.allow_emails
                || old.domain != candidate.domain
                || old.oauth_app != candidate.oauth_app
        };
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
        } else if active && changed {
            // A new allow list means a new tunnel and a new proof; the old
            // tunnel stops being served before the new one is requested.
            if let Err(e) = self.begin(&mut inner) {
                inner.status = ConnectionStatus::Failed;
                inner.failure = Some(failure_of(&e));
            }
        } else if inner.run.is_none() && inner.failure.is_none() {
            inner.status = idle_status(&inner.config, inner.token.is_some());
        }
        Ok(self.snapshot_now(&inner))
    }

    /// Start the connection. `token`, if given, replaces the one held in memory.
    /// With `save`, that token is also put in the OS keychain; if the keychain
    /// cannot take it nothing is started and nothing is changed. A start is an
    /// explicit request to stay on, so a disabled setting is saved as enabled
    /// first; nothing starts if that save fails.
    pub fn start(
        self: &Arc<Self>,
        token: Option<Secret>,
        save: bool,
    ) -> Result<Snapshot, StartError> {
        let mut inner = self.lock();
        if inner.failure == Some(FailureCode::ConfigUnreadable) {
            return Err(StartError::SettingsUnreadable);
        }
        self.probe_keychain(&mut inner);
        if save && let Some(token) = &token {
            self.vault
                .save(token)
                .map_err(|_| StartError::KeychainUnavailable)?;
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
        if inner.config.oauth_app == OauthApp::Custom && self.google.is_none() {
            return Err(StartError::Invalid(ContractError::MissingOauthCredentials));
        }
        if !inner.config.enabled {
            let next = ConnectionConfig {
                enabled: true,
                revision: inner.config.revision + 1,
                ..inner.config.clone()
            }
            .validated()
            .map_err(StartError::Invalid)?;
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
fn failure_of(error: &StartError) -> FailureCode {
    match error {
        StartError::Invalid(_) | StartError::TokenRequired => FailureCode::ConfigInvalid,
        _ => FailureCode::Internal,
    }
}
