use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::error::AgboardError;
use crate::lifecycle::LifecycleGuard;

/// How long a stopping server gets to finish its shutdown.
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(50);

/// Ask the server named by `serve.json` to shut down and wait until it has.
///
/// The server closes its port before it has finished shutting down, so a
/// closed port is not enough: `stop` also waits until the server has let go
/// of `lifecycle.lock`. Only then can the next `serve` start.
///
/// A missing or stale `serve.json` means nothing is running, which is not an
/// error: the end state the caller asked for already holds.
pub fn run(json: bool) -> Result<String, AgboardError> {
    let data_dir = crate::paths::data_dir()?;
    let Some(info) = crate::paths::read_serve_info_in(&data_dir) else {
        return Ok(render(json, None));
    };
    if !crate::server::is_serving(&info) {
        return Ok(render(json, None));
    }
    let pid = libc::pid_t::try_from(info.pid)
        .map_err(|_| unavailable("serve.json has an invalid pid.".to_string()))?;
    // SAFETY: SIGTERM asks the process to shut down; the server handles it as Ctrl+C.
    if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
        return Err(unavailable(format!(
            "Cannot signal the server (pid {}): {}.",
            info.pid,
            std::io::Error::last_os_error()
        )));
    }
    let deadline = Instant::now() + STOP_TIMEOUT;
    while crate::server::is_serving(&info) {
        if Instant::now() >= deadline {
            return Err(unavailable(format!(
                "The server (pid {}) did not stop within {} seconds.",
                info.pid,
                STOP_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(POLL);
    }
    wait_for_lifecycle(&data_dir, info.pid, deadline)?;
    Ok(render(json, Some(info.port)))
}

/// Wait until no process holds the lifecycle lock of `data_dir`, taking it
/// for a moment to know. Gives up at `deadline`.
fn wait_for_lifecycle(data_dir: &Path, pid: u32, deadline: Instant) -> Result<(), AgboardError> {
    loop {
        match LifecycleGuard::acquire(data_dir) {
            Ok(_released) => return Ok(()),
            Err(AgboardError::DatabaseBusy) if Instant::now() < deadline => {
                std::thread::sleep(POLL);
            }
            Err(AgboardError::DatabaseBusy) => {
                return Err(unavailable(format!(
                    "The server (pid {pid}) did not finish shutting down within {} seconds.",
                    STOP_TIMEOUT.as_secs()
                )));
            }
            Err(other) => return Err(other),
        }
    }
}

fn unavailable(reason: String) -> AgboardError {
    AgboardError::BoardUnavailable { reason }
}

fn render(json: bool, stopped_port: Option<u16>) -> String {
    match (json, stopped_port) {
        (true, Some(port)) => format!("{}\n", json!({ "stopped": true, "port": port })),
        (true, None) => format!("{}\n", json!({ "stopped": false })),
        (false, Some(port)) => format!("Stopped the server on port {port}.\n"),
        (false, None) => "No server is running.\n".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_waits_until_the_server_lets_go_of_the_lifecycle_lock() {
        let dir = tempfile::tempdir().unwrap();
        let held = LifecycleGuard::acquire(dir.path()).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(held);
        });
        let began = Instant::now();
        wait_for_lifecycle(dir.path(), 42, began + STOP_TIMEOUT).unwrap();
        assert!(began.elapsed() >= Duration::from_millis(250));
        release.join().unwrap();
        // `stop` only looked: the next `serve` can take the lock.
        LifecycleGuard::acquire(dir.path()).unwrap();
    }

    #[test]
    fn stop_fails_when_the_server_keeps_the_lifecycle_lock() {
        let dir = tempfile::tempdir().unwrap();
        let _held = LifecycleGuard::acquire(dir.path()).unwrap();
        let err = wait_for_lifecycle(dir.path(), 42, Instant::now() + Duration::from_millis(100))
            .unwrap_err();
        assert!(format!("{err:?}").contains("pid 42"), "{err:?}");
    }

    #[test]
    fn the_output_says_whether_a_server_was_stopped() {
        assert_eq!(
            render(false, Some(7420)),
            "Stopped the server on port 7420.\n"
        );
        assert_eq!(render(false, None), "No server is running.\n");
        assert_eq!(
            render(true, Some(7420)),
            "{\"port\":7420,\"stopped\":true}\n"
        );
        assert_eq!(render(true, None), "{\"stopped\":false}\n");
    }
}
