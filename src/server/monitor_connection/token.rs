//! The ngrok token held by the supervisor: where it came from, the OS keychain
//! lookup, deleting a saved token, and the snapshot that reports all of that
//! without the value.

use std::sync::Arc;
use std::time::Duration;

use super::contracts::{ConnectionStatus, PublicOrigin};
use super::keychain::VaultError;
use super::lifecycle::{Inner, MonitorConnections, idle_status};
use super::types::FailureCode;
use super::types::Settings;
use super::types::{ForgetError, Secret, Snapshot, TokenSource};

/// How long a settings read waits for the keychain before it answers with what
/// is known. The keychain usually answers at once; while it asks the user, the
/// read answers without it and a later read reports what it found.
const PROBE_GRACE: Duration = Duration::from_secs(1);

impl MonitorConnections {
    /// The current state. The first call starts the keychain read in the
    /// background and waits for it at most `PROBE_GRACE`, without the lock.
    pub async fn snapshot(self: &Arc<Self>) -> Snapshot {
        drop(self.synced());
        let _ = tokio::time::timeout(PROBE_GRACE, self.probed()).await;
        self.snapshot_now(&self.synced())
    }

    pub(super) fn snapshot_now(&self, inner: &Inner) -> Snapshot {
        snapshot_of(inner, self.vault.available(), self.domain.as_deref())
    }

    /// Look at the keychain once, off the request path. The keychain may stop
    /// to ask the user, so it is read on a blocking thread and the lock is not
    /// held meanwhile: every other request, and the idle check, keep going.
    /// Looked at lazily so that a run that never needs a token never touches it.
    pub(super) fn probe_in_background(self: &Arc<Self>, inner: &mut Inner) {
        if inner.keychain_saved.is_some() || inner.probing {
            return;
        }
        inner.probing = true;
        let epoch = inner.probe_epoch;
        let this = self.clone();
        tokio::spawn(async move {
            let loaded = this.read_keychain().await;
            let mut inner = this.lock();
            this.apply_probe(&mut inner, loaded, epoch);
        });
    }

    pub(super) async fn read_keychain(&self) -> Result<Option<Secret>, VaultError> {
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.load())
            .await
            .unwrap_or(Err(VaultError::Failed))
    }

    /// Record what a keychain read returned and wake whoever waits for it. A
    /// saved token is used when no other token is held (the environment and a
    /// token typed for this run both win). A read that fails counts as nothing saved.
    pub(super) fn apply_probe(
        &self,
        inner: &mut Inner,
        loaded: Result<Option<Secret>, VaultError>,
        epoch: u64,
    ) {
        if epoch != inner.probe_epoch {
            // The saved settings changed while the keychain was read: another read is needed.
            self.probed.notify_waiters();
            return;
        }
        inner.probing = false;
        let saved = matches!(loaded, Ok(Some(_)));
        if let Ok(Some(token)) = loaded
            && inner.token.is_none()
        {
            inner.token = Some(token);
            inner.token_source = Some(TokenSource::Keychain);
            if inner.run.is_none() && inner.failure.is_none() {
                inner.status = idle_status(&inner.config, true);
            }
        }
        inner.keychain_saved = Some(saved);
        self.probed.notify_waiters();
    }

    /// Wait until the keychain has been looked at, starting the read if nobody
    /// has. Only the caller waits; the lock is free while the keychain answers.
    pub(super) async fn probed(self: &Arc<Self>) {
        loop {
            let notified = self.probed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut inner = self.lock();
                if inner.keychain_saved.is_some() {
                    return;
                }
                self.probe_in_background(&mut inner);
            }
            notified.await;
        }
    }

    /// Take in settings saved from the command line (`agboard setup remote`, `agboard setup`),
    /// which write the file without going through this server. They always move the revision
    /// forward, so a file whose revision is not the one held here is newer. A saved token is
    /// found again too: the keychain is looked at again on the next read. A connection that is
    /// up is left alone; the new settings apply to the next start. An unreadable file is ignored.
    pub(super) fn synced(&self) -> std::sync::MutexGuard<'_, Inner> {
        let mut inner = self.lock();
        self.sync_locked(&mut inner);
        inner
    }

    /// The lock on the settings file and then the state, taken in that order, with the state
    /// brought up to date. Whoever changes the saved settings holds both until it has saved.
    pub(super) fn write_guard(
        &self,
    ) -> (super::config::ConfigLock, std::sync::MutexGuard<'_, Inner>) {
        let file = self.store.lock();
        (file, self.synced())
    }

    /// The file is read while the state is locked, so a read that is older than a save made here
    /// can never replace it.
    fn sync_locked(&self, inner: &mut Inner) {
        let Ok(file) = self.store.load() else {
            return;
        };
        if file.revision == inner.config.revision {
            return;
        }
        inner.config = file;
        if inner.failure == Some(FailureCode::ConfigUnreadable) {
            inner.failure = None;
        }
        // A keychain read that is under way started before this change: its result is dropped.
        inner.probe_epoch += 1;
        inner.probing = false;
        inner.keychain_saved = None;
        if inner.token_source == Some(TokenSource::Keychain) {
            inner.token = None;
            inner.token_source = None;
        }
        if inner.run.is_none() && inner.failure.is_none() {
            inner.status = idle_status(&inner.config, inner.token.is_some());
        }
    }

    /// Remove the saved token from the OS keychain. A token held only because
    /// it came from the keychain is forgotten too; the environment's token and
    /// one typed for this run stay. A running connection is not interrupted.
    /// The keychain is written without holding the lock, as it is read.
    /// The public address while the entrance is up (the connection is ready), else `None`.
    pub fn public_origin(&self) -> Option<PublicOrigin> {
        let inner = self.lock();
        if inner.status != ConnectionStatus::Ready {
            return None;
        }
        PublicOrigin::parse(inner.url.as_deref()?).ok()
    }

    pub async fn forget_token(self: &Arc<Self>) -> Result<Snapshot, ForgetError> {
        // A read still in flight would bring the token back after the delete.
        self.probed().await;
        let vault = self.vault.clone();
        tokio::task::spawn_blocking(move || vault.delete())
            .await
            .unwrap_or(Err(VaultError::Failed))
            .map_err(|_| ForgetError::KeychainUnavailable)?;
        let mut inner = self.lock();
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

fn snapshot_of(inner: &Inner, keychain_available: bool, domain_env: Option<&str>) -> Snapshot {
    Snapshot {
        status: inner.status,
        url: inner.url.clone(),
        revision: inner.config.revision,
        settings: Settings {
            enabled: inner.config.enabled,
            domain: inner.config.domain.clone(),
        },
        domain_env: domain_env.map(str::to_string),
        token_configured: inner.token.is_some(),
        token_source: inner.token_source,
        keychain_available,
        keychain_token_saved: inner.keychain_saved == Some(true),
        failure: inner.failure,
        // Only a connection that is up has a passcode worth showing.
        passcode: inner
            .passcode
            .clone()
            .filter(|_| inner.status == ConnectionStatus::Ready && inner.run.is_some()),
    }
}
