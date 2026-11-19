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

/// SIGKILL to the members of the group `pid` led, and only to them: unlike [`signal_group`] it
/// does not signal `pid` itself, which may have been reaped and reused by now.
#[cfg(unix)]
pub(super) fn kill_members(pid: u32) {
    // SAFETY: plain syscall; the group was created by the child that led it.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(not(unix))]
pub(super) fn kill_members(_pid: u32) {}

/// Whether any process is left in the group `pid` led (the leader's exit does not end it).
#[cfg(unix)]
pub(super) fn group_alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks that the group has a member.
    unsafe { libc::kill(-(pid as i32), 0) == 0 }
}

#[cfg(not(unix))]
pub(super) fn group_alive(_pid: u32) -> bool {
    false
}

/// Wait until nothing is left in the group `pid` led, for at most `limit`.
pub(super) fn wait_group_gone(pid: u32, limit: Duration) -> bool {
    let until = std::time::Instant::now() + limit;
    while group_alive(pid) {
        if std::time::Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    true
}

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
