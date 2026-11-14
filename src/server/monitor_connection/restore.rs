//! Restoring the saved connection when the server starts.

use std::sync::Arc;

use super::contracts::ConnectionStatus;
use super::keychain::VaultError;
use super::lifecycle::{Inner, MonitorConnections, failure_of, idle_status};
use super::types::TokenSource;

impl MonitorConnections {
    /// Start the saved connection with the token in hand. A failure is shown
    /// on the PC, not fatal.
    pub(super) fn restore(self: &Arc<Self>, inner: &mut Inner) {
        if inner.token.is_some() {
            if let Err(e) = self.begin(inner).map(drop) {
                inner.status = ConnectionStatus::Failed;
                inner.failure = Some(failure_of(&e));
            }
        } else {
            inner.status = ConnectionStatus::NeedsConfig;
        }
    }

    /// Read the keychain off the startup path, then restore. While the read is
    /// pending the status is `starting`; whatever the read returns is applied
    /// only if nothing else has started, stopped or changed the setting since.
    pub(super) fn restore_from_keychain(self: &Arc<Self>, inner: &mut Inner) {
        inner.probing = true;
        inner.status = ConnectionStatus::Starting;
        let generation = inner.generation;
        let this = self.clone();
        tokio::spawn(async move {
            let vault = this.vault.clone();
            let loaded = tokio::task::spawn_blocking(move || vault.load())
                .await
                .unwrap_or(Err(VaultError::Failed));
            let mut inner = this.lock();
            inner.probing = false;
            let saved = matches!(loaded, Ok(Some(_)));
            if let Ok(Some(token)) = loaded
                && inner.token.is_none()
            {
                inner.token = Some(token);
                inner.token_source = Some(TokenSource::Keychain);
            }
            inner.keychain_saved = Some(saved);
            if inner.run.is_some() || inner.failure.is_some() {
                return;
            }
            if inner.generation == generation && inner.config.enabled {
                this.restore(&mut inner);
            } else {
                inner.status = idle_status(&inner.config, inner.token.is_some());
            }
        });
    }
}
