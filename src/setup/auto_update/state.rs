//! The files of the automatic update of one agent: a lock, so concurrent
//! sessions reinstall once, and the record of the last attempt, so a failing
//! update is not retried on every session.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use super::PLUGIN_HASH;
use crate::setup::Agent;

/// A lock older than this is a left-over of a process that died.
const LOCK_STALE: Duration = Duration::from_secs(15 * 60);

/// The files of the update of one agent, under `<data>/plugin-update/`.
pub struct Files {
    lock: PathBuf,
    state: PathBuf,
}

/// What the last attempt left in the state file.
pub struct Attempt {
    pub hash: String,
    pub ok: bool,
    at: u64,
}

impl Attempt {
    pub fn age(&self) -> Duration {
        Duration::from_secs(now_secs().saturating_sub(self.at))
    }
}

/// Holds the lock until dropped.
pub struct Lock {
    path: PathBuf,
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

impl Files {
    pub fn new(data_dir: &Path, agent: Agent) -> Files {
        let dir = data_dir.join("plugin-update");
        Files {
            lock: dir.join(format!("{}.lock", agent.key())),
            state: dir.join(format!("{}.json", agent.key())),
        }
    }

    /// Whether a live update holds the lock.
    pub fn lock_held(&self) -> bool {
        fs::metadata(&self.lock)
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| {
                SystemTime::now()
                    .duration_since(modified)
                    .map_or(true, |age| age < LOCK_STALE)
            })
    }

    /// Takes the lock, or `None` when another update holds it. A stale lock
    /// is replaced.
    pub fn acquire(&self) -> Option<Lock> {
        fs::create_dir_all(self.lock.parent()?).ok()?;
        for _ in 0..2 {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&self.lock)
            {
                Ok(mut file) => {
                    use std::io::Write;
                    let _ = write!(file, "{}", std::process::id());
                    return Some(Lock {
                        path: self.lock.clone(),
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    if self.lock_held() {
                        return None;
                    }
                    let _ = fs::remove_file(&self.lock);
                }
                Err(_) => return None,
            }
        }
        None
    }

    pub fn last_attempt(&self) -> Option<Attempt> {
        let value: Value = serde_json::from_str(&fs::read_to_string(&self.state).ok()?).ok()?;
        Some(Attempt {
            hash: value.get("hash")?.as_str()?.to_string(),
            ok: value.get("ok")?.as_bool()?,
            at: value.get("at")?.as_u64()?,
        })
    }

    /// Records an attempt for the plugin hash this agboard ships.
    pub fn record(&self, ok: bool) {
        let text = json!({
            "hash": PLUGIN_HASH,
            "ok": ok,
            "at": now_secs(),
            "version": crate::setup::VERSION,
        });
        if let Some(dir) = self.state.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(&self.state, text.to_string());
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |age| age.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_lock_is_replaced_and_a_live_one_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::new(dir.path(), Agent::Claude);
        let lock = files.acquire().expect("first lock");
        assert!(files.lock_held());
        assert!(files.acquire().is_none());
        drop(lock);
        assert!(!files.lock_held());
        // A lock file that nobody has touched for a long time is stale.
        let held = files.acquire().unwrap();
        let old = SystemTime::now() - LOCK_STALE - Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(&files.lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert!(!files.lock_held());
        assert!(files.acquire().is_some());
        std::mem::forget(held);
    }

    #[test]
    fn an_attempt_is_recorded_for_the_shipped_hash() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::new(dir.path(), Agent::Codex);
        assert!(files.last_attempt().is_none());
        files.record(false);
        let attempt = files.last_attempt().unwrap();
        assert_eq!(attempt.hash, PLUGIN_HASH);
        assert!(!attempt.ok);
        assert!(attempt.age() < Duration::from_secs(5));
    }
}
