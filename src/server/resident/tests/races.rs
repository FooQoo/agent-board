//! Launches, stops, and deferred starts that overlap. Each test holds the overlap open with a
//! gate or a blocked resolver instead of sleeping, so the order it checks is the order it runs.

use std::sync::mpsc::channel;

use super::autostart::choice;
use super::health::{fast, state_of};
use super::spawn::Spawn;
use super::*;

type Gate = (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>);

/// A resolver that reports when it is entered and then waits to be released.
fn blocked_resolver(
    folder: std::path::PathBuf,
) -> (
    impl Fn(&ProjectId) -> Result<(String, std::path::PathBuf), AgboardError> + Send + 'static,
    Gate,
) {
    let (entered_tx, entered) = channel();
    let (release, release_rx) = channel::<()>();
    let release_rx = Mutex::new(release_rx);
    let resolve = move |_: &ProjectId| {
        entered_tx.send(()).unwrap();
        let _ = release_rx.lock().unwrap().recv();
        Ok(("demo".to_string(), folder.clone()))
    };
    (resolve, (entered, release))
}

/// The auto-start thread holds a launcher until it has finished: wait for `holders` to drop by
/// one, `holders` being the count read while it was still running.
fn wait_for_the_start_to_finish(fx: &Fixture, holders: usize) {
    wait_until("the auto-start to finish", || {
        Arc::strong_count(&fx.launcher) < holders
    });
}

#[test]
fn listing_the_sessions_does_not_wait_for_a_launch_that_is_checking_the_cli() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("slow"), "").unwrap();
    let slow = Launcher::new(
        fx.registry.clone(),
        Executables::fixed(
            Some(fx.dir.path().join("claude")),
            Some(fx.dir.path().join("codex")),
        )
        .with_timeout(Duration::from_secs(3)),
        &fx.dir.path().join("data"),
    );
    let launching = slow.clone();
    let (project, folder) = (project(), fx.folder.path().to_path_buf());
    let handle = std::thread::spawn(move || {
        launching.launch(&project, "demo", &folder, Tool::ClaudeCode, None)
    });
    // The launch is inside the login check now.
    fx.file("slow.started");
    let started = Instant::now();
    assert!(slow.status().is_empty());
    slow.health();
    assert!(slow.board_session(&super::project()).is_none());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(handle.join().unwrap().is_err());
}

#[test]
fn a_stop_waits_for_a_launch_in_progress_instead_of_racing_its_plan() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    let gate = fx.launcher.gate();
    let stopper = fx.launcher.clone();
    let (done_tx, done) = channel();
    let handle = std::thread::spawn(move || {
        let stopped = stopper.stop().unwrap();
        done_tx.send(()).unwrap();
        stopped
    });
    // The launch holds the gate; the stop is not through while it does.
    assert!(done.recv_timeout(Duration::from_millis(300)).is_err());
    drop(gate);
    assert!(!handle.join().unwrap());
}

#[test]
fn a_stop_cancels_an_auto_start_that_is_still_resolving_its_project() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(choice(Tool::ClaudeCode, None))
        .unwrap();
    let (resolve, (entered, release)) = blocked_resolver(fx.folder.path().to_path_buf());
    fx.launcher.start(resolve);
    entered.recv().unwrap();
    assert!(!fx.launcher.stop().unwrap());
    let holders = Arc::strong_count(&fx.launcher);
    release.send(()).unwrap();
    wait_for_the_start_to_finish(&fx, holders);
    assert!(fx.launcher.status().is_empty());
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Stopped);
    assert!(!fx.dir.path().join("claude.starts").exists());
}

#[test]
fn a_failing_auto_start_leaves_the_plan_of_a_launch_that_succeeded_meanwhile() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(choice(Tool::ClaudeCode, None))
        .unwrap();
    let (resolve, (entered, release)) = blocked_resolver(fx.folder.path().to_path_buf());
    fx.launcher.start(resolve);
    entered.recv().unwrap();
    // A person launches while the project resolves; the auto-start is then refused.
    let manual = fx.launch(Tool::ClaudeCode, Some("sonnet")).unwrap();
    let holders = Arc::strong_count(&fx.launcher);
    release.send(()).unwrap();
    wait_for_the_start_to_finish(&fx, holders);
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Running);
    assert!(health.reason.is_none(), "{:?}", health.reason);
    assert_eq!(health.model.as_deref(), Some("sonnet"));
    assert_eq!(fx.launcher.status().len(), 1);
    assert_eq!(fx.launcher.status()[0].pid, manual.pid);
    fx.launcher.shutdown();
}

#[test]
fn a_restart_prepared_for_a_stopped_plan_is_not_run_under_a_newer_one() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    // A backoff that outlasts the test keeps each restart waiting, so the supervisor cannot
    // relaunch the current plan before the checks below.
    let fx = fixture_timed(Timing {
        backoff_base: Duration::from_secs(60),
        backoff_max: Duration::from_secs(60),
        ..fast()
    });
    let restarting = |fx: &Fixture, pid: u32| -> u64 {
        let generation = fx.launcher.plans()[&Tool::ClaudeCode].generation;
        super::health::kill(pid);
        wait_until("the restart to be waiting", || {
            fx.launcher.restart_pending(Tool::ClaudeCode, generation)
        });
        generation
    };
    let first = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    let old = restarting(&fx, first.pid);
    fx.launcher.stop().unwrap();
    std::fs::remove_file(fx.dir.path().join("claude.record")).unwrap();
    let second = fx.launch(Tool::ClaudeCode, Some("sonnet")).unwrap();
    fx.record("claude");
    let new = restarting(&fx, second.pid);
    assert_ne!(old, new);

    let stale = fx.launcher.spawn_child(
        &project(),
        "demo",
        fx.folder.path(),
        Tool::ClaudeCode,
        None,
        Spawn::Relaunch(old),
    );
    assert_eq!(stale.unwrap_err().code(), "session_launch_refused");
    assert!(fx.launcher.status().is_empty());
    fx.launcher.stop().unwrap();
}

#[test]
fn a_stop_ends_a_command_that_outlives_the_session_and_ignores_sigterm() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("orphan"), "").unwrap();
    let launcher = Launcher::with_factory(
        fx.registry.clone(),
        Executables::fixed(
            Some(fx.dir.path().join("claude")),
            Some(fx.dir.path().join("codex")),
        ),
        &fx.dir.path().join("data"),
        Duration::from_millis(400),
        Timing::default(),
        driver::default_factory(),
    );
    launcher
        .launch(&project(), "demo", fx.folder.path(), Tool::ClaudeCode, None)
        .unwrap();
    let orphan: u32 = fx.file("orphan.pid").trim().parse().unwrap();
    assert!(alive(orphan));
    assert!(launcher.stop().unwrap());
    let ended = !alive(orphan);
    // Whatever the outcome, do not leave the process behind.
    super::health::kill(orphan);
    assert!(ended, "the command the session started is still running");
}
