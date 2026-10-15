//! Temporary-only regressions for server path capture and fixture environment isolation.

#[path = "support/mobile_monitor.rs"]
mod support;

use std::ffi::OsString;
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

use agent_board::file_store::{FileStore, layout, lock::WriteLock};
use agent_board::lifecycle::LifecycleGuard;
use agent_board::server::{ServeConfig, run_until};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvironmentRestore(Option<OsString>);

impl EnvironmentRestore {
    fn capture() -> Self {
        Self(std::env::var_os("AGBOARD_HOME"))
    }
}

impl Drop for EnvironmentRestore {
    fn drop(&mut self) {
        // SAFETY: every environment mutation in this test binary holds ENV_LOCK;
        // every server is stopped before its test releases the restoration guard.
        unsafe {
            match &self.0 {
                Some(value) => std::env::set_var("AGBOARD_HOME", value),
                None => std::env::remove_var("AGBOARD_HOME"),
            }
        }
    }
}

fn set_home(home: &std::path::Path) {
    // SAFETY: this deliberate startup race is serialized against other tests,
    // and both values point exclusively at temporary directories.
    unsafe { std::env::set_var("AGBOARD_HOME", home) };
}

#[test]
fn server_startup_keeps_its_captured_directory_when_environment_changes() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let _restore = EnvironmentRestore::capture();
    let home = tempfile::tempdir().unwrap();
    let sentinel = tempfile::tempdir().unwrap();
    let marker = b"Temporary sentinel: no server may replace this file.";
    std::fs::write(sentinel.path().join("serve.json"), marker).unwrap();
    let shared = home.path().join("shared");
    let project = FileStore::open(&shared)
        .create_project("Blocked startup", chrono::Utc::now())
        .unwrap();
    // Startup reconciliation cannot reach serve.json until this temporary lock is released.
    let write_lock = WriteLock::acquire(&layout::write_lock(&layout::project_dir(
        &shared,
        &project.id,
    )))
    .unwrap();
    set_home(home.path());
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
    let worker = std::thread::spawn(move || {
        run_until(
            ServeConfig { port: 0 },
            async move {
                let _ = stop_rx.await;
            },
            move |addr| {
                let _ = ready_tx.send(addr);
            },
        )
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !home.path().join("lifecycle.lock").exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    let captured_lifecycle = home.path().join("lifecycle.lock").exists();
    set_home(sentinel.path());
    drop(write_lock);
    let ready = ready_rx.recv_timeout(Duration::from_secs(10));
    let captured_info = agent_board::paths::read_serve_info_in(home.path());
    let sentinel_bytes = std::fs::read(sentinel.path().join("serve.json")).unwrap();
    let _ = stop_tx.send(());
    worker.join().unwrap().unwrap();
    assert!(
        captured_lifecycle,
        "startup must have selected the temporary home before changing the environment"
    );
    let addr = ready.unwrap();
    assert_eq!(
        captured_info.map(|info| info.port),
        Some(addr.port()),
        "serve.json must use the same captured home as lifecycle/shared"
    );
    assert_eq!(
        sentinel_bytes, marker,
        "another temporary home's serve.json must remain untouched"
    );
    assert!(!sentinel.path().join("shared").exists());
    assert!(!sentinel.path().join("lifecycle.lock").exists());
    assert!(
        !home.path().join("serve.json").exists(),
        "shutdown removes only its captured registration"
    );
}

#[test]
fn monitor_fixture_restores_parent_environment_and_does_not_clear_it_at_shutdown() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let _restore = EnvironmentRestore::capture();
    let parent = tempfile::tempdir().unwrap();
    let next_parent = tempfile::tempdir().unwrap();
    let home = support::home();
    set_home(parent.path());
    let server = support::Running::start(home.path());
    let after_start = std::env::var_os("AGBOARD_HOME");
    set_home(next_parent.path());
    drop(server);
    let after_shutdown = std::env::var_os("AGBOARD_HOME");
    assert_eq!(after_start.as_deref(), Some(parent.path().as_os_str()));
    assert_eq!(
        after_shutdown.as_deref(),
        Some(next_parent.path().as_os_str())
    );
}

#[test]
fn failed_monitor_fixture_start_restores_parent_environment() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let _restore = EnvironmentRestore::capture();
    let parent = tempfile::tempdir().unwrap();
    let home = support::home();
    let _busy = LifecycleGuard::acquire(home.path()).unwrap();
    set_home(parent.path());
    let failed = std::panic::catch_unwind(|| support::Running::start(home.path()));
    let after_failure = std::env::var_os("AGBOARD_HOME");
    assert!(
        failed.is_err(),
        "the temporary lifecycle lock must refuse startup"
    );
    assert_eq!(after_failure.as_deref(), Some(parent.path().as_os_str()));
    assert!(!parent.path().join("serve.json").exists());
}
