//! The Web Push subscriptions of registered devices, and the VAPID key pair that identifies
//! this board to the push services.
//!
//! A phone that has added the board to its home screen can subscribe to Web Push. The browser
//! hands over an endpoint URL and two keys; they are kept here, one subscription per device, in
//! `<data_dir>/.internal/push-subscriptions.json` (owner-only, replaced atomically), so they
//! survive a restart. A device that is unregistered loses its subscription.
//!
//! The VAPID key pair (P-256) is made once, the first time something asks for it, and kept in
//! `<data_dir>/.internal/vapid-key.json` (owner-only). The private key never leaves this
//! module except through [`PushStore::vapid_signer`], which the sender uses to sign.
//!
//! An unreadable or unrecognized subscription file is treated as an empty list; the phones
//! subscribe again. An unreadable key file is replaced by a new key pair, which makes the old
//! subscriptions unusable, so they are dropped with it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use ring::rand::SystemRandom;
use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
use serde::{Deserialize, Serialize};

use super::config::write_private_atomic;
use super::devices::SaveFailed;

const SUBSCRIPTIONS_FILE: &str = "push-subscriptions.json";
const KEY_FILE: &str = "vapid-key.json";
const INTERNAL_DIR: &str = ".internal";
const FORMAT_VERSION: u32 = 1;
const MAX_ENDPOINT: usize = 2048;

/// One device's subscription, as the browser's `PushSubscription` gives it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Subscription {
    pub device_id: String,
    /// The push service URL that a message is posted to.
    pub endpoint: String,
    /// The browser's public key (65 bytes, uncompressed P-256), base64url.
    pub p256dh: String,
    /// The browser's 16-byte authentication secret, base64url.
    pub auth: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscriptionsFile {
    format_version: u32,
    subscriptions: Vec<Subscription>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyFile {
    format_version: u32,
    /// The private key as PKCS#8, base64url.
    pkcs8: String,
}

/// What the browser is given to subscribe with: the uncompressed public key, base64url.
#[derive(Clone)]
struct Vapid {
    pkcs8: Vec<u8>,
    public: String,
}

/// Why a subscription was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Invalid {
    Endpoint,
    Keys,
}

pub struct PushStore {
    dir: Option<PathBuf>,
    subscriptions: Mutex<Vec<Subscription>>,
    vapid: Mutex<Option<Vapid>>,
}

fn now_text() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn vapid_of(pkcs8: Vec<u8>) -> Option<Vapid> {
    let pair = EcdsaKeyPair::from_pkcs8(
        &ECDSA_P256_SHA256_FIXED_SIGNING,
        &pkcs8,
        &SystemRandom::new(),
    )
    .ok()?;
    let public = B64.encode(pair.public_key().as_ref());
    Some(Vapid { pkcs8, public })
}

/// Whether an endpoint is a public HTTPS push service address: no credentials, no IP address and
/// no single-label host, so the sender is never pointed at the PC's own network.
fn endpoint_ok(endpoint: &str) -> bool {
    if endpoint.len() > MAX_ENDPOINT {
        return false;
    }
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    let host_ok =
        matches!(url.host(), Some(url::Host::Domain(d)) if d.contains('.') && d != "localhost");
    url.scheme() == "https"
        && host_ok
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn key_ok(text: &str, len: usize, first: Option<u8>) -> bool {
    text.len() <= 128
        && B64
            .decode(text)
            .is_ok_and(|b| b.len() == len && first.is_none_or(|f| b[0] == f))
}

impl PushStore {
    /// The subscriptions saved in this data area's internal folder.
    pub fn open(data_dir: &Path) -> Self {
        let dir = data_dir.join(INTERNAL_DIR);
        let subscriptions = std::fs::read(dir.join(SUBSCRIPTIONS_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<SubscriptionsFile>(&b).ok())
            .filter(|f| f.format_version == FORMAT_VERSION)
            .map(|f| f.subscriptions)
            .unwrap_or_default();
        Self {
            dir: Some(dir),
            subscriptions: Mutex::new(subscriptions),
            vapid: Mutex::new(None),
        }
    }

    /// A store that is never written to disk (tests and unit checks).
    pub fn in_memory() -> Self {
        Self {
            dir: None,
            subscriptions: Mutex::new(Vec::new()),
            vapid: Mutex::new(None),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Subscription>> {
        self.subscriptions.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, list: &[Subscription]) -> Result<(), SaveFailed> {
        let Some(dir) = &self.dir else {
            return Ok(());
        };
        let file = SubscriptionsFile {
            format_version: FORMAT_VERSION,
            subscriptions: list.to_vec(),
        };
        let mut text = serde_json::to_string_pretty(&file).map_err(|_| SaveFailed)?;
        text.push('\n');
        write_private_atomic(&dir.join(SUBSCRIPTIONS_FILE), text.as_bytes()).map_err(|_| SaveFailed)
    }

    /// The key pair, made and saved the first time. When it cannot be saved nothing is used, so
    /// a subscription is never made with a key that would be lost at the next start.
    fn vapid(&self) -> Result<Vapid, SaveFailed> {
        let mut slot = self.vapid.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(vapid) = slot.as_ref() {
            return Ok(vapid.clone());
        }
        let saved = self.dir.as_ref().and_then(|dir| {
            let file: KeyFile =
                serde_json::from_slice(&std::fs::read(dir.join(KEY_FILE)).ok()?).ok()?;
            (file.format_version == FORMAT_VERSION)
                .then(|| B64.decode(file.pkcs8).ok())
                .flatten()
                .and_then(vapid_of)
        });
        let vapid = match saved {
            Some(vapid) => vapid,
            None => {
                let document = EcdsaKeyPair::generate_pkcs8(
                    &ECDSA_P256_SHA256_FIXED_SIGNING,
                    &SystemRandom::new(),
                )
                .map_err(|_| SaveFailed)?;
                let vapid = vapid_of(document.as_ref().to_vec()).ok_or(SaveFailed)?;
                if let Some(dir) = &self.dir {
                    let file = KeyFile {
                        format_version: FORMAT_VERSION,
                        pkcs8: B64.encode(&vapid.pkcs8),
                    };
                    let text = serde_json::to_string_pretty(&file).map_err(|_| SaveFailed)?;
                    write_private_atomic(&dir.join(KEY_FILE), text.as_bytes())
                        .map_err(|_| SaveFailed)?;
                    // A new key makes every older subscription useless.
                    let mut list = self.lock();
                    if !list.is_empty() {
                        list.clear();
                        let _ = self.save(&list);
                    }
                }
                vapid
            }
        };
        *slot = Some(vapid.clone());
        Ok(vapid)
    }

    /// The public key the browser subscribes with (`applicationServerKey`), base64url.
    pub fn public_key(&self) -> Result<String, SaveFailed> {
        Ok(self.vapid()?.public)
    }

    /// The key pair that signs VAPID headers, for the sender. The private key is not exposed
    /// in any other way.
    pub fn vapid_signer(&self) -> Result<EcdsaKeyPair, SaveFailed> {
        let vapid = self.vapid()?;
        EcdsaKeyPair::from_pkcs8(
            &ECDSA_P256_SHA256_FIXED_SIGNING,
            &vapid.pkcs8,
            &SystemRandom::new(),
        )
        .map_err(|_| SaveFailed)
    }

    /// Keep this device's subscription, replacing an older one. The input is checked first.
    pub fn subscribe(
        &self,
        device_id: &str,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
    ) -> Result<Result<(), Invalid>, SaveFailed> {
        if !endpoint_ok(endpoint) {
            return Ok(Err(Invalid::Endpoint));
        }
        if !key_ok(p256dh, 65, Some(0x04)) || !key_ok(auth, 16, None) {
            return Ok(Err(Invalid::Keys));
        }
        // The key pair must exist before a subscription that depends on it is kept.
        self.vapid()?;
        let mut list = self.lock();
        let mut next: Vec<Subscription> = list
            .iter()
            .filter(|s| s.device_id != device_id)
            .cloned()
            .collect();
        next.push(Subscription {
            device_id: device_id.to_string(),
            endpoint: endpoint.to_string(),
            p256dh: p256dh.to_string(),
            auth: auth.to_string(),
            created_at: now_text(),
        });
        self.save(&next)?;
        *list = next;
        Ok(Ok(()))
    }

    /// Forget a device's subscription. `Ok(false)` when it had none.
    pub fn unsubscribe(&self, device_id: &str) -> Result<bool, SaveFailed> {
        let mut list = self.lock();
        if !list.iter().any(|s| s.device_id == device_id) {
            return Ok(false);
        }
        let next: Vec<Subscription> = list
            .iter()
            .filter(|s| s.device_id != device_id)
            .cloned()
            .collect();
        self.save(&next)?;
        *list = next;
        Ok(true)
    }

    pub fn is_subscribed(&self, device_id: &str) -> bool {
        self.lock().iter().any(|s| s.device_id == device_id)
    }

    /// Every subscription kept, oldest first.
    pub fn list(&self) -> Vec<Subscription> {
        self.lock().clone()
    }

    /// Drop the subscriptions of devices that are no longer registered (for example the one a
    /// full device list pushed out).
    pub fn retain_devices(&self, is_registered: impl Fn(&str) -> bool) {
        let mut list = self.lock();
        let next: Vec<Subscription> = list
            .iter()
            .filter(|s| is_registered(&s.device_id))
            .cloned()
            .collect();
        if next.len() != list.len() && self.save(&next).is_ok() {
            *list = next;
        }
    }
}

#[cfg(test)]
mod tests;
