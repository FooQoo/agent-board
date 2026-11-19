//! The phones and browsers registered to open the board without the passcode.
//!
//! A device is registered when someone enters the right passcode. It gets a random 256-bit
//! device token in a long-lived cookie; only the SHA-256 digest of that token is kept, here in
//! memory and in `<data_dir>/.internal/remote-devices.json` (owner-only, replaced atomically),
//! next to a label, the public origin it was registered for, and two times. The file is
//! app-internal state and survives a restart and a stop of the connection; the sessions that a
//! device opens do not (see `monitor_auth::session`).
//!
//! An unreadable or unrecognized file is treated as an empty list: no device is accepted until
//! it is registered again, and the next change writes a fresh file.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use super::config::write_private_atomic;
use super::lifecycle::MonitorConnections;
use crate::server::monitor_auth::contracts::{constant_time_eq, secret_hash};

const FILE_NAME: &str = "remote-devices.json";
const INTERNAL_DIR: &str = ".internal";
const FORMAT_VERSION: u32 = 1;
/// The most devices kept; registering one more drops the one seen longest ago.
pub const MAX_DEVICES: usize = 32;
const MAX_LABEL: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stored {
    id: String,
    /// Hex SHA-256 of the device token.
    token_hash: String,
    label: String,
    origin: String,
    created_at: String,
    last_seen_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct File {
    format_version: u32,
    devices: Vec<Stored>,
}

/// What the PC may see of a device. Never the token or its digest.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub last_seen_at: String,
}

impl From<&Stored> for DeviceInfo {
    fn from(d: &Stored) -> Self {
        Self {
            id: d.id.clone(),
            label: d.label.clone(),
            created_at: d.created_at.clone(),
            last_seen_at: d.last_seen_at.clone(),
        }
    }
}

/// The raw token to hand to the browser once, and the device it opens.
pub struct Registered {
    pub token: String,
    pub id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SaveFailed;

pub struct DeviceStore {
    path: Option<PathBuf>,
    devices: Mutex<Vec<Stored>>,
    removed: broadcast::Sender<String>,
}

fn now_text() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn random_hex(bytes: usize) -> std::io::Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

impl DeviceStore {
    /// The devices saved in this data area's internal folder.
    pub fn open(data_dir: &Path) -> Self {
        let path = data_dir.join(INTERNAL_DIR).join(FILE_NAME);
        let devices = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<File>(&bytes).ok())
            .filter(|file| file.format_version == FORMAT_VERSION)
            .map(|file| file.devices)
            .unwrap_or_default();
        Self::with(Some(path), devices)
    }

    /// A store that is never written to disk (tests and unit checks).
    pub fn in_memory() -> Self {
        Self::with(None, Vec::new())
    }

    fn with(path: Option<PathBuf>, devices: Vec<Stored>) -> Self {
        Self {
            path,
            devices: Mutex::new(devices),
            removed: broadcast::channel(16).0,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Stored>> {
        self.devices.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, devices: &[Stored]) -> Result<(), SaveFailed> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let file = File {
            format_version: FORMAT_VERSION,
            devices: devices.to_vec(),
        };
        let mut text = serde_json::to_string_pretty(&file).map_err(|_| SaveFailed)?;
        text.push('\n');
        write_private_atomic(path, text.as_bytes()).map_err(|_| SaveFailed)
    }

    /// Register a device for this public origin. When the save fails nothing is registered.
    pub fn register(
        &self,
        origin: &str,
        user_agent: Option<&str>,
    ) -> Result<Registered, SaveFailed> {
        let token = random_hex(32).map_err(|_| SaveFailed)?;
        let id = format!("dev_{}", random_hex(8).map_err(|_| SaveFailed)?);
        let now = now_text();
        let device = Stored {
            id: id.clone(),
            token_hash: secret_hash(&token),
            label: device_label(user_agent),
            origin: origin.to_string(),
            created_at: now.clone(),
            last_seen_at: now,
        };
        let mut devices = self.lock();
        let mut next = devices.clone();
        if next.len() >= MAX_DEVICES
            && let Some(oldest) = next
                .iter()
                .enumerate()
                .min_by(|a, b| a.1.last_seen_at.cmp(&b.1.last_seen_at))
                .map(|(i, _)| i)
        {
            next.remove(oldest);
        }
        next.push(device);
        self.save(&next)?;
        *devices = next;
        Ok(Registered { token, id })
    }

    /// The device that a cookie value belongs to, for this public origin. Records that it was
    /// seen; a failed save of that note does not refuse the device.
    pub fn authenticate(&self, token: &str, origin: &str) -> Option<String> {
        let hash = secret_hash(token);
        let mut devices = self.lock();
        let found = devices.iter_mut().find(|d| {
            constant_time_eq(d.token_hash.as_bytes(), hash.as_bytes()) && d.origin == origin
        })?;
        found.last_seen_at = now_text();
        let id = found.id.clone();
        let _ = self.save(&devices);
        Some(id)
    }

    /// Whether the device is still registered.
    pub fn contains(&self, id: &str) -> bool {
        self.lock().iter().any(|d| d.id == id)
    }

    /// The registered devices, the one seen last first.
    pub fn list(&self) -> Vec<DeviceInfo> {
        let mut list: Vec<DeviceInfo> = self.lock().iter().map(DeviceInfo::from).collect();
        list.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
        list
    }

    /// Forget a device and tell the open event streams of its sessions to end. `Ok(false)` when
    /// there was no such device; when the save fails the device stays registered.
    pub fn remove(&self, id: &str) -> Result<bool, SaveFailed> {
        let mut devices = self.lock();
        let Some(index) = devices.iter().position(|d| d.id == id) else {
            return Ok(false);
        };
        let mut next = devices.clone();
        next.remove(index);
        self.save(&next)?;
        *devices = next;
        drop(devices);
        let _ = self.removed.send(id.to_string());
        Ok(true)
    }

    /// Ids of devices as they are removed.
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.removed.subscribe()
    }
}

impl MonitorConnections {
    /// The registered devices, the one seen last first.
    pub fn devices(&self) -> Vec<DeviceInfo> {
        self.devices.list()
    }

    /// The Web Push subscriptions to send to: one per registered device that subscribed. Entries
    /// whose device is no longer registered are dropped first. Sending is done elsewhere; use
    /// [`PushStore::vapid_signer`] through [`MonitorConnections::push_store`] to sign.
    pub fn push_subscriptions(&self) -> Vec<super::push::Subscription> {
        self.push.retain_devices(|id| self.devices.contains(id));
        self.push.list()
    }

    /// The push store, for the sender's VAPID signing key.
    pub fn push_store(&self) -> &Arc<super::push::PushStore> {
        &self.push
    }

    /// Unregister a device. Its sessions that are still valid end at once, and so do their open
    /// event streams. `Ok(false)` when there is no such device.
    pub fn remove_device(&self, id: &str) -> Result<bool, SaveFailed> {
        let removed = self.devices.remove(id)?;
        if removed {
            // A device that is gone is no longer a send target. If this save fails the stale
            // entry is dropped by `push_subscriptions` the next time it is read.
            let _ = self.push.unsubscribe(id);
            let policy = self
                .lock()
                .run
                .as_ref()
                .and_then(|run| run.gate.read().unwrap_or_else(|e| e.into_inner()).clone());
            if let Some(policy) = policy {
                policy.sessions.revoke_device(id);
            }
        }
        Ok(removed)
    }
}

/// A short name for the list on the PC, from the browser's `User-Agent`. It is a hint to tell
/// devices apart, not an identity; anything unknown is "Unknown device".
pub fn device_label(user_agent: Option<&str>) -> String {
    let ua = user_agent.unwrap_or_default();
    let platform = [
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Android", "Android"),
        ("Macintosh", "Mac"),
        ("Windows", "Windows"),
        ("CrOS", "Chromebook"),
        ("Linux", "Linux"),
    ]
    .iter()
    .find(|(needle, _)| ua.contains(needle))
    .map(|(_, name)| *name);
    // The order matters: Edge and Opera also say Chrome, and Chrome also says Safari.
    let browser = [
        ("EdgiOS", "Edge"),
        ("Edg/", "Edge"),
        ("OPR/", "Opera"),
        ("CriOS", "Chrome"),
        ("FxiOS", "Firefox"),
        ("Firefox", "Firefox"),
        ("Chrome", "Chrome"),
        ("Safari", "Safari"),
    ]
    .iter()
    .find(|(needle, _)| ua.contains(needle))
    .map(|(_, name)| *name);
    let label = match (platform, browser) {
        (Some(p), Some(b)) => format!("{p} / {b}"),
        (Some(p), None) => p.to_string(),
        (None, Some(b)) => b.to_string(),
        (None, None) => "Unknown device".to_string(),
    };
    label.chars().take(MAX_LABEL).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://abc.ngrok.app";

    #[test]
    fn a_registered_device_is_found_by_its_token_for_its_origin_only() {
        let s = DeviceStore::in_memory();
        let r = s.register(ORIGIN, Some("iPhone Safari")).unwrap();
        assert_eq!(r.token.len(), 64);
        assert_eq!(s.authenticate(&r.token, ORIGIN), Some(r.id.clone()));
        assert_eq!(s.authenticate(&r.token, "https://other.ngrok.app"), None);
        assert_eq!(s.authenticate("nope", ORIGIN), None);
    }

    #[test]
    fn only_a_digest_reaches_the_file_and_it_survives_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let s = DeviceStore::open(dir.path());
        let r = s.register(ORIGIN, None).unwrap();
        let text =
            std::fs::read_to_string(dir.path().join(".internal/remote-devices.json")).unwrap();
        assert!(!text.contains(&r.token));
        assert!(text.contains(&secret_hash(&r.token)));
        let again = DeviceStore::open(dir.path());
        assert_eq!(again.authenticate(&r.token, ORIGIN), Some(r.id.clone()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(".internal/remote-devices.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
    }

    #[test]
    fn removing_forgets_the_device_for_good_and_announces_it() {
        let dir = tempfile::tempdir().unwrap();
        let s = DeviceStore::open(dir.path());
        let r = s.register(ORIGIN, None).unwrap();
        let mut rx = s.subscribe();
        assert_eq!(s.remove("dev_missing"), Ok(false));
        assert_eq!(s.remove(&r.id), Ok(true));
        assert_eq!(rx.try_recv().unwrap(), r.id);
        assert_eq!(s.authenticate(&r.token, ORIGIN), None);
        assert_eq!(DeviceStore::open(dir.path()).list(), vec![]);
    }

    #[test]
    fn an_unreadable_file_means_no_devices_and_the_list_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".internal")).unwrap();
        std::fs::write(
            dir.path().join(".internal/remote-devices.json"),
            "{not json",
        )
        .unwrap();
        let s = DeviceStore::open(dir.path());
        assert!(s.list().is_empty());
        for _ in 0..MAX_DEVICES + 3 {
            s.register(ORIGIN, None).unwrap();
        }
        assert_eq!(s.list().len(), MAX_DEVICES);
    }

    #[test]
    fn labels_tell_devices_apart_without_trusting_the_header() {
        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_label(Some(iphone)), "iPhone / Safari");
        let edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120";
        assert_eq!(device_label(Some(edge)), "Windows / Edge");
        assert_eq!(device_label(None), "Unknown device");
        assert!(device_label(Some(&"iPhone".repeat(500))).len() <= MAX_LABEL);
    }
}
