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

/// How many earlier logs of a tool are kept next to the current one (`<tool>.1.log` is the
/// previous launch, `<tool>.4.log` the oldest).
pub(super) const KEEP_LOGS: u32 = 4;

/// The name of the log `generation` launches ago: `claude-code.log`, `claude-code.1.log`, ...
fn generation_path(path: &Path, generation: u32) -> std::path::PathBuf {
    if generation == 0 {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("log");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("log");
    path.with_file_name(format!("{stem}.{generation}.{ext}"))
}

/// Move each log one generation back, dropping the one beyond [`KEEP_LOGS`]. A launch then starts
/// a fresh file and the last few runs stay readable. Moving an old file that fails is not worth
/// refusing a launch for.
fn rotate_logs(path: &Path) {
    if !path.exists() {
        return;
    }
    let _ = std::fs::remove_file(generation_path(path, KEEP_LOGS));
    for generation in (0..KEEP_LOGS).rev() {
        let from = generation_path(path, generation);
        if from.exists() {
            let _ = std::fs::rename(&from, generation_path(path, generation + 1));
        }
    }
}

pub(super) fn open_log(path: &Path) -> std::io::Result<std::fs::File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    rotate_logs(path);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn each_launch_keeps_the_earlier_logs_up_to_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude-code.log");
        for run in 0..8 {
            let mut file = open_log(&path).unwrap();
            std::io::Write::write_all(&mut file, format!("run {run}").as_bytes()).unwrap();
        }
        assert_eq!(read(&path), "run 7");
        assert_eq!(read(&dir.path().join("claude-code.1.log")), "run 6");
        assert_eq!(read(&dir.path().join("claude-code.4.log")), "run 3");
        assert!(!dir.path().join("claude-code.5.log").exists());
    }

    #[test]
    fn the_first_launch_creates_only_the_current_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("resident").join("codex.log");
        open_log(&path).unwrap();
        assert!(path.is_file());
        assert!(!dir.path().join("resident").join("codex.1.log").exists());
    }
}
