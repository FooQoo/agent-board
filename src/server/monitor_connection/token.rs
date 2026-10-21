//! The ngrok token held by the supervisor: where it came from, the OS keychain
//! lookup, deleting a saved token, and the snapshot that reports all of that
//! without the value.

use super::lifecycle::{Inner, MonitorConnections, idle_status};
use super::types::Settings;
use super::types::{ForgetError, Snapshot, TokenSource};

impl MonitorConnections {
    pub fn snapshot(&self) -> Snapshot {
        let mut inner = self.lock();
        self.probe_keychain(&mut inner);
        self.snapshot_now(&inner)
    }

    pub(super) fn snapshot_now(&self, inner: &Inner) -> Snapshot {
        snapshot_of(inner, self.vault.available())
    }

    /// Look at the keychain once. A saved token is used when no other token is
    /// held (the environment and a token typed for this run both win). A read
    /// that fails counts as nothing saved. Looked at lazily so that a run that
    /// never needs a token never touches the keychain.
    pub(super) fn probe_keychain(&self, inner: &mut Inner) {
        if inner.keychain_saved.is_some() {
            return;
        }
        let saved = match self.vault.load() {
            Ok(Some(token)) => {
                if inner.token.is_none() {
                    inner.token = Some(token);
                    inner.token_source = Some(TokenSource::Keychain);
                    if inner.run.is_none() && inner.failure.is_none() {
                        inner.status = idle_status(&inner.config, true);
                    }
                }
                true
            }
            _ => false,
        };
        inner.keychain_saved = Some(saved);
    }

    /// Remove the saved token from the OS keychain. A token held only because
    /// it came from the keychain is forgotten too; the environment's token and
    /// one typed for this run stay. A running connection is not interrupted.
    pub fn forget_token(&self) -> Result<Snapshot, ForgetError> {
        let mut inner = self.lock();
        self.vault
            .delete()
            .map_err(|_| ForgetError::KeychainUnavailable)?;
        inner.keychain_saved = Some(false);
        if inner.token_source == Some(TokenSource::Keychain) {
            inner.token = None;
            inner.token_source = None;
            if inner.run.is_none() && inner.failure.is_none() {
                inner.status = idle_status(&inner.config, false);
            }
        }
        Ok(self.snapshot_now(&inner))
    }
}

fn snapshot_of(inner: &Inner, keychain_available: bool) -> Snapshot {
    Snapshot {
        status: inner.status,
        url: inner.url.clone(),
        revision: inner.config.revision,
        settings: Settings {
            enabled: inner.config.enabled,
            allow_emails: inner.config.allow_emails.clone(),
            domain: inner.config.domain.clone(),
            oauth_app: inner.config.oauth_app,
        },
        token_configured: inner.token.is_some(),
        token_source: inner.token_source,
        keychain_available,
        keychain_token_saved: inner.keychain_saved == Some(true),
        failure: inner.failure,
    }
}
