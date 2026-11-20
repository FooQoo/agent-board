//! Restoring the saved connection when the server starts.

use std::sync::Arc;

use super::contracts::ConnectionStatus;
use super::lifecycle::{Inner, MonitorConnections, failure_of, idle_status};
use super::types::Snapshot;

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
        let epoch = inner.probe_epoch;
        let this = self.clone();
        tokio::spawn(async move {
            let mut epoch = epoch;
            loop {
                let loaded = this.read_keychain().await;
                let mut inner = this.lock();
                if !this.apply_probe(&mut inner, loaded, epoch) {
                    // The saved settings changed during the read: read again, still starting.
                    epoch = inner.probe_epoch;
                    inner.probing = true;
                    continue;
                }
                if inner.run.is_some() || inner.failure.is_some() {
                    return;
                }
                if inner.generation == generation && inner.config.enabled {
                    this.restore(&mut inner);
                } else {
                    inner.status = idle_status(&inner.config, inner.token.is_some());
                }
                return;
            }
        });
    }

    /// Stop the connection, forget any pending start, and save `enabled: false`.
    pub fn stop(self: &Arc<Self>) -> Snapshot {
        // Without the file lock the connection is still stopped, but nothing is saved.
        let (file, mut inner) = match self.write_guard() {
            Ok((file, inner)) => (Some(file), inner),
            Err(_) => (None, self.lock()),
        };
        self.teardown(&mut inner);
        if inner.config.enabled && file.is_some() {
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
}
