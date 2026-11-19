//! Health, restarts, and auto-start, with timings short enough to watch them happen.

use super::*;

fn fast() -> Timing {
    Timing {
        tick: Duration::from_millis(20),
        backoff_base: Duration::from_millis(20),
        backoff_max: Duration::from_millis(100),
        max_failures: 3,
        window: Duration::from_secs(30),
        startup_allowance: Duration::from_secs(30),
    }
}

fn no_projects(_: &ProjectId) -> Result<(String, std::path::PathBuf), AgboardError> {
    Err(AgboardError::ProjectNotFound {
        project: "none".into(),
    })
}

fn state_of(fx: &Fixture, tool: Tool) -> Health {
    fx.launcher
        .health()
        .into_iter()
        .find(|h| h.tool == tool)
        .unwrap()
}

fn starts(fx: &Fixture, name: &str) -> usize {
    std::fs::read_to_string(fx.dir.path().join(format!("{name}.starts")))
        .map(|t| t.lines().count())
        .unwrap_or(0)
}

fn kill(pid: u32) {
    // SAFETY: plain signal to the group of a child the test started (it leads its own group),
    // so the `sleep` it runs does not outlive the test.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

fn attach(fx: &Fixture, tool: Tool) -> crate::server::sessions::SessionHold {
    fx.registry.register(Attributes {
        project: project(),
        key: "resident:abc".into(),
        tool,
        origin: Origin::Board,
    })
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
    assert!(fx.launcher.stop(Tool::ClaudeCode).unwrap());
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
    fx.launcher.stop(Tool::ClaudeCode).unwrap();
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Stopped);
}

#[test]
fn a_child_that_never_waits_on_the_board_is_replaced() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        startup_allowance: Duration::from_millis(200),
        backoff_base: Duration::from_millis(400),
        backoff_max: Duration::from_millis(400),
        ..fast()
    });
    fx.launcher.start(no_projects);
    let first = fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the unhealthy child to be ended", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Restarting
    });
    let health = state_of(&fx, Tool::ClaudeCode);
    assert!(health.reason.unwrap().contains("never waited"));
    assert!(!alive(first.pid));
    wait_until("the replacement", || starts(&fx, "claude") == 2);
    fx.launcher.shutdown();
}

#[test]
fn an_attached_child_is_left_alone_even_while_it_works() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(Timing {
        startup_allowance: Duration::from_secs(1),
        ..fast()
    });
    fx.launcher.start(no_projects);
    fx.launch(Tool::ClaudeCode, None).unwrap();
    let _hold = attach(&fx, Tool::ClaudeCode);
    // Wait for the supervisor to see the attach, however slow the machine is.
    wait_until("the attach to be seen", || {
        fx.launcher
            .plans()
            .get(&Tool::ClaudeCode)
            .is_some_and(|plan| plan.attached.is_some())
    });
    // Outlive the startup allowance with no wait registered.
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(starts(&fx, "claude"), 1);
    assert_eq!(state_of(&fx, Tool::ClaudeCode).state, HealthState::Running);
    assert!(state_of(&fx, Tool::ClaudeCode).waiting);
    // A session that works on a task has closed its wait; it is left alone however long it takes.
    drop(_hold);
    fx.registry.remove_board(Tool::ClaudeCode);
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(starts(&fx, "claude"), 1);
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Running);
    assert!(!health.waiting);
    fx.launcher.shutdown();
}

#[test]
fn auto_start_launches_the_saved_sessions_when_the_server_starts() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(
            Tool::ClaudeCode,
            Some(AutoStart {
                project_id: project(),
                model: Some("sonnet".into()),
            }),
        )
        .unwrap();
    let folder = fx.folder.path().to_path_buf();
    fx.launcher
        .start(move |_| Ok(("demo".to_string(), folder.clone())));
    assert!(fx.record("claude").contains("--model sonnet"));
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.state, HealthState::Running);
    assert_eq!(health.auto_start.unwrap().model.as_deref(), Some("sonnet"));
    assert_eq!(state_of(&fx, Tool::Codex).state, HealthState::Stopped);
    assert!(state_of(&fx, Tool::Codex).auto_start.is_none());
    fx.launcher.shutdown();
}

#[test]
fn a_failing_auto_start_shows_as_failed_and_does_not_block_the_start() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    std::fs::write(fx.dir.path().join("logged-out"), "").unwrap();
    for tool in [Tool::ClaudeCode, Tool::Codex] {
        fx.launcher
            .autostart()
            .set(
                tool,
                Some(AutoStart {
                    project_id: project(),
                    model: None,
                }),
            )
            .unwrap();
    }
    let folder = fx.folder.path().to_path_buf();
    let started = Instant::now();
    fx.launcher
        .start(move |_| Ok(("demo".to_string(), folder.clone())));
    assert!(started.elapsed() < Duration::from_secs(2));
    for tool in [Tool::ClaudeCode, Tool::Codex] {
        wait_until("the failed state", || {
            state_of(&fx, tool).state == HealthState::Failed
        });
        assert!(state_of(&fx, tool).reason.unwrap().contains("Log in to"));
    }
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn an_auto_start_whose_project_is_gone_fails_with_the_reason() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(
            Tool::Codex,
            Some(AutoStart {
                project_id: project(),
                model: None,
            }),
        )
        .unwrap();
    fx.launcher.start(no_projects);
    wait_until("the failed state", || {
        state_of(&fx, Tool::Codex).state == HealthState::Failed
    });
    assert!(state_of(&fx, Tool::Codex).reason.is_some());
    assert_eq!(state_of(&fx, Tool::Codex).project_id, Some(project()));
}

#[test]
fn the_autostart_file_round_trips_and_removes_a_choice() {
    let fx = fixture();
    let store = fx.launcher.autostart();
    let choice = AutoStart {
        project_id: project(),
        model: None,
    };
    store.set(Tool::Codex, Some(choice.clone())).unwrap();
    assert_eq!(store.get(Tool::Codex), Some(choice));
    assert_eq!(store.get(Tool::ClaudeCode), None);
    let text =
        std::fs::read_to_string(fx.dir.path().join("data/.internal/resident-autostart.json"))
            .unwrap();
    assert!(text.contains("\"formatVersion\": 1"), "{text}");
    store.set(Tool::Codex, None).unwrap();
    assert!(store.all().is_empty());
    std::fs::write(
        fx.dir.path().join("data/.internal/resident-autostart.json"),
        "nope",
    )
    .unwrap();
    assert!(store.all().is_empty());
}
