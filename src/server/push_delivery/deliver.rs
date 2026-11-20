//! Sending the chosen notifications to every subscribed device, and trying again when a push
//! service does not take one.
//!
//! The [`Dispatcher`] holds the three things delivery needs besides the board: the ledger of
//! what was sent, the transport to the push services, and a clock. Everything else arrives in
//! a [`Context`] built when there is something to send: the subscriptions, the public address
//! (links need it, so nothing is sent while the entrance is down), the saved settings, and the
//! language.

use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use chrono::{DateTime, Duration, Utc};

use super::events::{Event, choose};
use super::ledger::{Entry, Ledger, State};
use super::message::{Lang, Payload, payload_of};
use super::transport::{Outcome, PushTransport, Request, TTL_SECONDS, topic_of};
use super::webpush;
use crate::server::monitor_connection::contracts::PublicOrigin;
use crate::server::monitor_connection::push::{PushStore, Subscription};
use crate::server::notification_settings::NotificationSettings;

/// The contact a push service may use to reach the operator of this board (RFC 8292 `sub`).
const VAPID_SUBJECT: &str = "https://github.com/FooQoo/agent-board";
/// How long to wait after the first, second, third and fourth failure.
const BACKOFF_SECONDS: [i64; 4] = [60, 300, 1800, 7200];
/// A message is given up after this many tries.
const MAX_ATTEMPTS: u32 = 5;

pub(crate) type NowFn = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

/// What one round of delivery works with.
pub(super) struct Context {
    pub store: Arc<PushStore>,
    pub subscriptions: Vec<Subscription>,
    /// The public address while the entrance is up; `None` otherwise.
    pub origin: Option<PublicOrigin>,
    pub settings: NotificationSettings,
    pub lang: Lang,
}

pub(super) struct Dispatcher {
    pub(super) ledger: Ledger,
    transport: Arc<dyn PushTransport>,
    pub(super) now: NowFn,
}

impl Dispatcher {
    pub(super) fn new(ledger: Ledger, transport: Arc<dyn PushTransport>, now: NowFn) -> Self {
        Self {
            ledger,
            transport,
            now,
        }
    }

    fn entry(&self, device: &str, key: &str, state: State, attempts: u32) -> Entry {
        Entry {
            device_id: device.to_string(),
            key: key.to_string(),
            state,
            attempts,
            at: (self.now)(),
            retry_at: None,
            payload: None,
        }
    }

    /// Send what the saved settings choose from `events`: for each task one notification, to
    /// every device that has not had that event yet. Nothing here fails the caller.
    pub(super) async fn deliver(&self, ctx: &Context, events: Vec<Event>) {
        for (winner, keys) in choose(events, &ctx.settings) {
            let fresh: Vec<&Subscription> = ctx
                .subscriptions
                .iter()
                .filter(|s| !self.ledger.has(&s.device_id, &winner.key))
                .collect();
            let Some(origin) = &ctx.origin else {
                for sub in fresh {
                    let skipped = self.entry(&sub.device_id, &winner.key, State::Skipped, 0);
                    self.ledger.record(skipped);
                }
                continue;
            };
            let Some(payload) = payload_of(&winner, ctx.lang, origin) else {
                continue;
            };
            let sends = fresh
                .into_iter()
                .map(|sub| self.send(ctx, sub, &winner.key, &keys, &payload, 0));
            futures_util::future::join_all(sends).await;
        }
    }

    /// Try the failed sends whose time has come.
    pub(super) async fn retry_due(&self, ctx: &Context) {
        if ctx.origin.is_none() {
            return;
        }
        for entry in self.ledger.due((self.now)()) {
            let sub = ctx
                .subscriptions
                .iter()
                .find(|s| s.device_id == entry.device_id);
            match (sub, entry.payload) {
                (Some(sub), Some(payload)) => {
                    let keys = [entry.key.clone()];
                    let tries = entry.attempts;
                    self.send(ctx, sub, &entry.key, &keys, &payload, tries)
                        .await;
                }
                _ => {
                    let dropped =
                        self.entry(&entry.device_id, &entry.key, State::Dropped, entry.attempts);
                    self.ledger.record(dropped);
                }
            }
        }
    }

    async fn send(
        &self,
        ctx: &Context,
        sub: &Subscription,
        key: &str,
        keys: &[String],
        payload: &Payload,
        attempts: u32,
    ) {
        let Some(origin) = &ctx.origin else {
            return;
        };
        let outcome = self.post(ctx, sub, origin, payload).await;
        let tries = attempts + 1;
        match outcome {
            Outcome::Delivered => {
                for key in keys {
                    self.ledger
                        .record(self.entry(&sub.device_id, key, State::Sent, tries));
                }
            }
            Outcome::Gone => {
                // The phone forgot the subscription: it is no longer a target. A replacement
                // subscribed while this request was in flight has another endpoint and stays.
                let removed = ctx
                    .store
                    .unsubscribe_endpoint(&sub.device_id, &sub.endpoint);
                if removed == Ok(true) {
                    self.ledger.forget_device(&sub.device_id);
                }
            }
            Outcome::Retry if tries < MAX_ATTEMPTS => {
                let wait = BACKOFF_SECONDS[(tries as usize - 1).min(BACKOFF_SECONDS.len() - 1)];
                let mut pending = self.entry(&sub.device_id, key, State::Pending, tries);
                pending.retry_at = Some(pending.at + Duration::seconds(wait));
                pending.payload = Some(payload.clone());
                self.ledger.record(pending);
            }
            Outcome::Retry | Outcome::Rejected => {
                self.ledger
                    .record(self.entry(&sub.device_id, key, State::Dropped, tries));
            }
        }
    }

    /// Encrypt, sign, and post one message. A key that cannot be used is a refusal.
    async fn post(
        &self,
        ctx: &Context,
        sub: &Subscription,
        origin: &PublicOrigin,
        payload: &Payload,
    ) -> Outcome {
        let request = (|| {
            let public = B64.decode(&sub.p256dh).ok()?;
            let auth = B64.decode(&sub.auth).ok()?;
            let body = webpush::encrypt(&public, &auth, &payload.json(origin)).ok()?;
            let signer = ctx.store.vapid_signer().ok()?;
            let now = (self.now)().timestamp().max(0) as u64;
            let authorization =
                webpush::vapid_authorization(&signer, &sub.endpoint, VAPID_SUBJECT, now).ok()?;
            Some(Request {
                endpoint: sub.endpoint.clone(),
                authorization,
                ttl: TTL_SECONDS,
                urgency: if payload.urgent { "high" } else { "normal" },
                topic: topic_of(&payload.tag),
                body,
            })
        })();
        match request {
            Some(request) => self.transport.send(request).await,
            None => Outcome::Rejected,
        }
    }
}

#[cfg(test)]
mod tests;
