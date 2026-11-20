//! The launcher driven through the [`AgentDriver`] trait: a scripted `MockDriver` for the
//! bookkeeping, and the real Claude driver against a fake `claude` for the stream-json exchange.

use super::*;
use crate::server::resident::driver::mock::{Call, Step, factory};
use crate::server::resident::driver::{
    DriverEvent, PermissionAnswer, PermissionKind, PermissionRequest, TurnOutcome,
    decide_permission,
};

fn event(event: DriverEvent) -> Step {
    Step::Event(event)
}

fn started() -> Step {
    event(DriverEvent::Started {
        session_id: Some("s".into()),
        tool_version: Some("1.0.0".into()),
    })
}

fn calls_of(calls: &crate::server::resident::driver::mock::Calls) -> Vec<Call> {
    calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[test]
fn the_policy_allows_every_request_for_now() {
    for kind in [
        PermissionKind::Command,
        PermissionKind::FileChange,
        PermissionKind::Other,
    ] {
        let request = PermissionRequest {
            kind,
            summary: "x".into(),
        };
        assert_eq!(decide_permission(&request), PermissionAnswer::Allow);
    }
}

#[test]
fn a_permission_request_is_answered_allow_and_a_turn_end_does_not_end_the_session() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let (make, calls) = factory(vec![
        started(),
        event(DriverEvent::PermissionRequest {
            id: "p1".into(),
            kind: PermissionKind::Command,
            summary: "Bash: ls".into(),
        }),
        event(DriverEvent::TurnEnded(TurnOutcome::Completed)),
        event(DriverEvent::Unknown),
    ]);
    let fx = fixture_with(Timing::default(), make);
    fx.launch(Tool::ClaudeCode, Some("haiku")).unwrap();
    wait_until("the answer", || {
        calls_of(&calls).iter().any(|call| {
            matches!(call, Call::Answer { id, answer: PermissionAnswer::Allow } if id == "p1")
        })
    });
    // The turn ended, and the session is still the board's session, running.
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(fx.launcher.status().len(), 1);
    assert_eq!(fx.launcher.health().state, HealthState::Running);

    let start = calls_of(&calls)[0].clone();
    let Call::Start { prompt, env } = start else {
        panic!("the first call is the start");
    };
    assert!(prompt.starts_with("You were launched by Agent Board"));
    assert!(env.contains(&("AGBOARD_SESSION_ORIGIN".to_string(), "board".to_string())));

    assert!(fx.launcher.stop().unwrap());
    assert!(calls_of(&calls).contains(&Call::Stop));
    assert!(fx.launcher.status().is_empty());
    assert_eq!(fx.launcher.health().state, HealthState::Stopped);
}

#[test]
fn only_an_exit_event_ends_a_session_and_it_is_restarted_with_the_reason() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let (make, calls) = factory(vec![
        started(),
        event(DriverEvent::TurnEnded(TurnOutcome::Failed {
            message: "x".into(),
        })),
        Step::Sleep(Duration::from_millis(100)),
        event(DriverEvent::Exited {
            code: Some(3),
            signal: None,
        }),
    ]);
    let timing = Timing {
        backoff_base: Duration::from_secs(30),
        backoff_max: Duration::from_secs(30),
        ..health::fast()
    };
    let fx = fixture_with(timing, make);
    fx.launcher.start(health::no_projects);
    fx.launch(Tool::ClaudeCode, None).unwrap();
    wait_until("the restart to wait", || {
        fx.launcher.health().state == HealthState::Restarting
    });
    let health = fx.launcher.health();
    let reason = health.reason.unwrap();
    assert!(reason.contains("exit status: 3"), "{reason}");
    assert!(fx.launcher.status().is_empty());
    assert_eq!(calls_of(&calls).len(), 1);
    fx.launcher.stop().unwrap();
}

#[test]
fn a_session_that_ignores_its_closed_input_is_still_ended() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("stubborn"), "").unwrap();
    let launched = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.file("claude.stdin");
    assert!(fx.launcher.stop().unwrap());
    assert!(!alive(launched.pid));
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn the_real_driver_answers_a_can_use_tool_request_with_an_allow_that_echoes_the_input() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("ask-permission"), "").unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    let answer: serde_json::Value = serde_json::from_str(fx.file("claude.answer").trim()).unwrap();
    assert_eq!(answer["type"], "control_response");
    assert_eq!(answer["response"]["subtype"], "success");
    assert_eq!(answer["response"]["request_id"], "req-1");
    assert_eq!(answer["response"]["response"]["behavior"], "allow");
    assert_eq!(
        answer["response"]["response"]["updatedInput"],
        serde_json::json!({"file_path": "/tmp/x", "content": "hi"})
    );
    // The session logged its tool version from system/init.
    let log = std::fs::read_to_string(fx.launcher.log_path(Tool::ClaudeCode)).unwrap();
    assert!(
        log.contains("agboard: claude-code 9.9.9 session fake-1"),
        "{log}"
    );
    assert!(fx.launcher.status().len() == 1);
    fx.launcher.shutdown();
}

#[test]
fn a_working_session_reports_the_subagents_it_waits_on_and_logs_their_start_and_end() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("run-task"), "").unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    // The session is mid-turn: it works, waiting for the subagent that has not ended.
    let log_path = fx.launcher.log_path(Tool::ClaudeCode);
    let log = || std::fs::read_to_string(&log_path).unwrap_or_default();
    wait_until("both task events are logged", || {
        log().contains("agboard: background task completed: t2 pnpm test")
    });
    assert_eq!(fx.launcher.health().background_tasks, ["Review the diff"]);
    assert!(!fx.launcher.health().waiting);
    assert!(
        log().contains("agboard: background task started: t1 Review the diff"),
        "{}",
        log()
    );
    fx.launcher.shutdown();
}
