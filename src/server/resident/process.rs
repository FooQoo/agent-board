//! The process side of the launcher: a marker for a finished child, signals to a process group,
//! the log file, and the launch ID.

use std::fs::OpenOptions;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use super::driver::AgentDriver;
use crate::error::AgboardError;

/// Marks a finished child; set by the reaper after it has cleaned up.
pub(super) struct Exit {
    done: Mutex<bool>,
    changed: Condvar,
}

impl Exit {
    pub(super) fn new() -> Arc<Exit> {
        Arc::new(Exit {
            done: Mutex::new(false),
            changed: Condvar::new(),
        })
    }

    pub(super) fn finish(&self) {
        *self.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }

    pub(super) fn wait(&self, limit: Duration) -> bool {
        let guard = self.done.lock().unwrap_or_else(|e| e.into_inner());
        let (guard, _) = self
            .changed
            .wait_timeout_while(guard, limit, |done| !*done)
            .unwrap_or_else(|e| e.into_inner());
        *guard
    }
}

/// Stop each driver and wait until its reaper has cleaned up. A driver ends its own process:
/// its input closes first, then SIGTERM to the group, then SIGKILL after `grace`.
pub(super) fn terminate(targets: &[(Arc<dyn AgentDriver>, Arc<Exit>)], grace: Duration) {
    for (driver, exit) in targets {
        driver.stop(grace);
        exit.wait(Duration::from_secs(2));
    }
}

#[cfg(unix)]
pub(super) fn signal_group(pid: u32, kill: bool) {
    let signal = if kill { libc::SIGKILL } else { libc::SIGTERM };
    // SAFETY: plain syscalls; the child was started as the leader of its own process group, so
    // `-pid` names only that child and the commands it started.
    unsafe {
        libc::kill(-(pid as i32), signal);
        libc::kill(pid as i32, signal);
    }
}

#[cfg(not(unix))]
pub(super) fn signal_group(_pid: u32, _kill: bool) {}

pub(super) fn open_log(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
}

/// A random launch ID: `resident-` and 16 hex digits.
pub(super) fn new_launch_id() -> Result<String, AgboardError> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| AgboardError::SessionLaunchFailed {
        reason: format!("Cannot create a launch ID: {e}."),
    })?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("resident-{hex}"))
}
