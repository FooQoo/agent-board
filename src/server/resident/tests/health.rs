//! Health, restarts, and auto-start, with timings short enough to watch them happen.

use super::*;

pub(super) fn fast() -> Timing {
    Timing {
        tick: Duration::from_millis(20),
        backoff_base: Duration::from_millis(20),
        backoff_max: Duration::from_millis(100),
        max_failures: 3,
        window: Duration::from_secs(30),
        startup_allowance: Duration::from_secs(30),
        push_poll: Duration::from_millis(50),
        push_backoff_base: Duration::from_millis(100),
        push_backoff_max: Duration::from_millis(400),
        push_max_attempts: 3,
    }
}

pub(super) fn no_projects(_: &ProjectId) -> Result<(String, std::path::PathBuf), AgboardError> {
    Err(AgboardError::ProjectNotFound {
        project: "none".into(),
    })
}

pub(super) fn state_of(fx: &Fixture, _tool: Tool) -> Health {
    fx.launcher.health()
}

fn starts(fx: &Fixture, name: &str) -> usize {
    std::fs::read_to_string(fx.dir.path().join(format!("{name}.starts")))
        .map(|t| t.lines().count())
        .unwrap_or(0)
}

pub(super) fn kill(pid: u32) {
    // SAFETY: plain signal to the group of a child the test started (it leads its own group),
    // so the `sleep` it runs does not outlive the test.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[test]
fn a_session_that_dies_is_relaunched_with_the_same_project_tool_and_model() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher.start(no_projects);
    let first = fx.launch(Tool::ClaudeCode, Some("sonnet")).unwrap();
    fx.record("claude");
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Running);
    kill(first.pid);
    wait_until("the relaunch", || starts(&fx, "claude") == 2);
    wait_until("the new child to be tracked", || {
        let status = fx.launcher.status();
        status.len() == 1 && status[0].pid != first.pid
    });
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Running);
    assert_eq!(health.restart_count, 1);
    assert_eq!(health.model.as_deref(), Some("sonnet"));
    assert_eq!(health.project_id, Some(project()));
    assert!(health.last_exit_at.is_some());
    assert!(fx.record("claude").contains("--model sonnet"));
    fx.launcher.shutdown();
}

#[test]
fn a_crash_loop_stops_retrying_and_says_why() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher.start(no_projects);
    std::fs::write(fx.dir.path().join("exit-now"), "").unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the failed state", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Failed
    });
    let health = state_of(&fx, Tool::ClaudeCode);
    let reason = health.reason.unwrap();
    assert!(reason.contains("exited"), "{reason}");
    assert!(reason.contains("stopped restarting"), "{reason}");
    assert_eq!(health.restart_count, 2);
    assert!(health.next_restart_at.is_none());
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(starts(&fx, "claude"), 3);
    assert!(fx.launcher.status().is_empty());
    // A person can launch again, which clears the failure.
    std::fs::remove_file(fx.dir.path().join("exit-now")).unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Running);
    assert_eq!(state_of(&fx, Tool::ClaudeCode).restart_count, 0);
    fx.launcher.shutdown();
}

#[test]
fn a_stop_by_a_person_never_restarts() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher.start(no_projects);
    fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    assert!(fx.launcher.stop().unwrap());
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(starts(&fx, "claude"), 1);
    assert!(fx.launcher.status().is_empty());
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Stopped);
    assert_eq!(health.restart_count, 0);
    fx.launcher.shutdown();
}

#[test]
fn a_stop_while_a_restart_is_waiting_cancels_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        backoff_base: Duration::from_secs(30),
        backoff_max: Duration::from_secs(30),
        ..fast()
    });
    fx.launcher.start(no_projects);
    let launched = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    kill(launched.pid);
    wait_until("the restart to wait", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Restarting
    });
    assert!(state_of(&fx, Tool::ClaudeCode).next_restart_at.is_some());
    fx.launcher.stop().unwrap();
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Stopped);
}

#[test]
fn a_child_that_never_starts_is_replaced() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        startup_allowance: Duration::from_millis(200),
        backoff_base: Duration::from_millis(400),
        backoff_max: Duration::from_millis(400),
        ..fast()
    });
    fx.launcher.start(no_projects);
    // The fake child reads its first instruction and then says nothing.
    std::fs::write(fx.dir.path().join("silent"), "").unwrap();
    let first = fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the unhealthy child to be ended", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Restarting
    });
    let health = state_of(&fx, Tool::ClaudeCode);
    assert!(health.reason.unwrap().contains("never started"));
    assert!(!alive(first.pid));
    wait_until("the replacement", || starts(&fx, "claude") == 2);
    fx.launcher.shutdown();
}

#[test]
fn an_attached_child_is_left_alone_even_while_it_works() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        startup_allowance: Duration::from_millis(500),
        ..fast()
    });
    fx.launcher.start(no_projects);
    // The fake child reports a session (its first event) and then works on its first turn.
    fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the attach to be seen", || {
        fx.launcher
            .plans()
            .get(&Tool::ClaudeCode)
            .is_some_and(|plan| plan.attached.is_some())
    });
    // Outlive the startup allowance; a turn on a task can take far longer than any limit.
    std::thread::sleep(Duration::from_millis(1000));
    assert_eq!(starts(&fx, "claude"), 1);
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Running);
    assert!(!health.waiting, "a session in its turn is not waiting");
    fx.launcher.shutdown();
}

#[test]
fn a_session_between_turns_is_waiting_and_listed_as_connected() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher.start(no_projects);
    std::fs::write(fx.dir.path().join("finish-turn"), "").unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the session to be waiting", || {
        state_of(&fx, Tool::ClaudeCode).waiting
    });
    let listed = fx.launcher.board_session(&project()).unwrap();
    assert_eq!(listed.origin, Origin::Board);
    assert_eq!(listed.tool, Tool::ClaudeCode);
    assert_eq!(listed.state, crate::server::sessions::State::Connected);
    // No wait ever registered: the registry knows nothing of it.
    assert!(!fx.registry.has_board(Tool::ClaudeCode));
    assert!(
        fx.launcher
            .board_session(&"f".repeat(32).parse().unwrap())
            .is_none()
    );
    fx.launcher.shutdown();
}

#[test]
fn a_launch_of_the_other_tool_is_refused_while_a_restart_waits() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        backoff_base: Duration::from_secs(30),
        backoff_max: Duration::from_secs(30),
        ..fast()
    });
    fx.launcher.start(no_projects);
    let launched = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    kill(launched.pid);
    wait_until("the restart to wait", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Restarting
    });
    let refused = fx.launch(Tool::Codex, None).unwrap_err();
    assert_eq!(refused.code(), "session_launch_refused");
    assert!(refused.reason().contains("claude-code"));
    fx.launcher.stop().unwrap();
    // The slot is free again, and a failure that was shown does not hold it.
    fx.launch(Tool::Codex, None).unwrap();
    fx.launcher.shutdown();
}

/// Collect the server log lines about the launcher.
fn collect_events(fx: &Fixture) -> Arc<Mutex<Vec<String>>> {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    fx.launcher.set_event_sink(Box::new(move |line| {
        sink.lock().unwrap().push(line.to_string());
    }));
    lines
}

fn has_event(lines: &Arc<Mutex<Vec<String>>>, needle: &str) -> bool {
    lines.lock().unwrap().iter().any(|l| l.contains(needle))
}

#[test]
fn a_stop_by_a_person_is_written_to_the_server_log_with_its_reason_and_time() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    let events = collect_events(&fx);
    fx.launch(Tool::ClaudeCode, Some("sonnet")).unwrap();
    assert!(fx.launcher.stop().unwrap());
    wait_until("the exit line", || has_event(&events, "ended after a stop"));
    let lines = events.lock().unwrap().clone();
    assert!(
        lines.iter().all(|l| l.starts_with("agboard: 20")),
        "{lines:?}"
    );
    assert!(lines.iter().any(|l| l.contains("started: pid")
        && l.contains("claude-code")
        && l.contains("model sonnet")));
    assert!(
        lines
            .iter()
            .any(|l| l.contains("stop requested") && l.contains("a person asked to stop it"))
    );
    assert!(!lines.iter().any(|l| l.contains("abnormally")), "{lines:?}");
    fx.launcher.shutdown();
}

#[test]
fn a_server_shutdown_is_written_to_the_server_log() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    let events = collect_events(&fx);
    fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.launcher.shutdown();
    assert!(has_event(&events, "the server is shutting down"));
    wait_until("the exit line", || has_event(&events, "ended after a stop"));
}

#[test]
fn an_abnormal_exit_is_written_to_the_server_log_with_what_happens_next() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    let events = collect_events(&fx);
    fx.launcher.start(no_projects);
    let first = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    kill(first.pid);
    wait_until("the abnormal exit line", || {
        has_event(&events, "exited abnormally")
    });
    wait_until("the restart line", || {
        has_event(&events, "restart planned for")
    });
    assert!(has_event(&events, "signal: 9"));
    assert!(!has_event(&events, "stop requested"));
    fx.launcher.shutdown();
}
