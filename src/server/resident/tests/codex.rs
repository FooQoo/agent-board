//! The real Codex driver against a fake `codex` that speaks `app-server` JSON-RPC: the launch
//! settings, the answers to what the server asks, and the control of a turn.

use std::fs::File;

use serde_json::{Value, json};

use super::*;
use crate::server::resident::driver::codex::CodexDriver;
use crate::server::resident::driver::{
    AgentDriver, DriverEvent, PermissionAnswer, PermissionKind, StartSpec, TurnOutcome,
};

impl Fixture {
    /// The lines the fake `codex` has received so far, as JSON.
    fn received(&self) -> Vec<Value> {
        std::fs::read_to_string(self.dir.path().join("codex.stdin"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    fn wait_for_line(&self, what: &str, found: impl Fn(&Value) -> bool) -> Value {
        let mut hit = None;
        wait_until(what, || {
            hit = self.received().into_iter().find(|line| found(line));
            hit.is_some()
        });
        hit.unwrap()
    }

    fn wait_for_method(&self, method: &str) -> Value {
        self.wait_for_line(method, |line| line["method"] == method)
    }

    /// A driver of its own on the fake, with the first message `hello`.
    fn driver(&self) -> CodexDriver {
        let driver = CodexDriver::new(&self.dir.path().join("codex"));
        driver
            .start(StartSpec {
                cwd: self.folder.path().to_path_buf(),
                model: None,
                prompt: "hello".to_string(),
                writable_dirs: vec![],
                env: vec![],
                log: File::create(self.dir.path().join("direct.log")).unwrap(),
            })
            .unwrap();
        driver
    }
}

/// Read events until `found` accepts one, and return everything read.
fn events_until(driver: &CodexDriver, found: impl Fn(&DriverEvent) -> bool) -> Vec<DriverEvent> {
    let mut seen = Vec::new();
    loop {
        let event = driver.next_event();
        let hit = found(&event);
        let ended = matches!(event, DriverEvent::Exited { .. });
        seen.push(event);
        assert!(!ended || hit, "the session ended first: {seen:?}");
        if hit {
            return seen;
        }
    }
}

/// The turn is running and known to the driver once its first activity arrives.
fn working(driver: &CodexDriver) {
    events_until(
        driver,
        |e| matches!(e, DriverEvent::Activity { summary, .. } if summary == "working"),
    );
}

#[test]
fn codex_starts_an_app_server_with_the_workspace_sandbox_automatic_review_and_the_data_area() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    fx.launch(Tool::Codex, None).unwrap();
    let record = fx.record("codex");
    assert!(record.contains("ARGS: app-server\n"), "{record}");
    assert!(!record.contains("bypass"), "{record}");

    let thread = fx.wait_for_method("thread/start")["params"].clone();
    let data = fx.dir.path().join("data");
    assert_eq!(thread["sandbox"], "workspace-write");
    assert_eq!(thread["approvalPolicy"], "on-request");
    assert_eq!(thread["approvalsReviewer"], "auto_review");
    assert_eq!(
        thread["config"]["sandbox_workspace_write"]["writable_roots"],
        json!([data.display().to_string()])
    );
    assert!(thread.get("model").is_none(), "{thread}");
    let folder = std::fs::canonicalize(fx.folder.path()).unwrap();
    assert_eq!(
        std::fs::canonicalize(thread["cwd"].as_str().unwrap()).unwrap(),
        folder
    );

    // The first instruction is the first turn, not an argument.
    let turn = fx.wait_for_method("turn/start")["params"].clone();
    assert_eq!(turn["threadId"], "fake-thread");
    let text = turn["input"][0]["text"].as_str().unwrap();
    assert!(
        text.starts_with("You were launched by Agent Board"),
        "{text}"
    );
    let log = std::fs::read_to_string(fx.launcher.log_path(Tool::Codex)).unwrap();
    wait_until("the version note", || {
        std::fs::read_to_string(fx.launcher.log_path(Tool::Codex))
            .unwrap()
            .contains("agboard: codex 9.9.9 thread fake-thread")
    });
    assert!(!log.contains("ARGS"), "{log}");
    fx.launcher.stop().unwrap();

    fx.launch(Tool::Codex, Some("gpt-a")).unwrap();
    let thread = fx.wait_for_line("a thread with a model", |line| {
        line["method"] == "thread/start" && line["params"]["model"] == "gpt-a"
    });
    assert_eq!(thread["params"]["sandbox"], "workspace-write");
    fx.launcher.shutdown();
}

#[test]
fn the_launcher_allows_an_approval_request_and_refuses_an_unknown_one() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("ask-permission"), "").unwrap();
    fx.launch(Tool::Codex, None).unwrap();
    let accepted = fx.wait_for_line("the approval answer", |line| line["id"] == 77);
    assert_eq!(
        accepted,
        json!({"id": 77, "result": {"decision": "accept"}})
    );
    let refused = fx.wait_for_line("the error for the unknown request", |line| line["id"] == 78);
    assert_eq!(refused["error"]["code"], -32601);
    assert_eq!(fx.launcher.status().len(), 1);
    fx.launcher.shutdown();
}

#[test]
fn a_denied_request_is_declined_without_a_reason() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("ask-permission"), "").unwrap();
    let driver = fx.driver();
    let seen = events_until(&driver, |e| {
        matches!(e, DriverEvent::PermissionRequest { .. })
    });
    let Some(DriverEvent::PermissionRequest { id, kind, summary }) = seen.last() else {
        unreachable!();
    };
    assert_eq!(*kind, PermissionKind::Command);
    assert_eq!(summary, "command: ls -la");
    driver
        .answer_permission(
            id,
            PermissionAnswer::Deny {
                reason: "no".into(),
            },
        )
        .unwrap();
    let answer = fx.wait_for_line("the answer", |line| line["id"] == 77);
    assert_eq!(answer, json!({"id": 77, "result": {"decision": "decline"}}));
    assert!(
        driver
            .answer_permission(id, PermissionAnswer::Allow)
            .is_err()
    );
    driver.stop(Duration::from_secs(5));
}

#[test]
fn a_failed_turn_ends_the_turn_and_not_the_session() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("fail-turn"), "").unwrap();
    let driver = fx.driver();
    let seen = events_until(&driver, |e| matches!(e, DriverEvent::TurnEnded(_)));
    assert!(matches!(
        seen.first(),
        Some(DriverEvent::Started { tool_version: Some(v), .. }) if v == "9.9.9"
    ));
    assert_eq!(
        seen.last(),
        Some(&DriverEvent::TurnEnded(TurnOutcome::Failed {
            message: "boom".into()
        }))
    );
    assert!(driver.is_idle());
    // The session is still there: a new message starts a new turn.
    driver.send_user_message("again").unwrap();
    let turns = |fx: &Fixture| {
        fx.received()
            .iter()
            .filter(|line| line["method"] == "turn/start")
            .count()
    };
    wait_until("the second turn", || turns(&fx) == 2);
    driver.stop(Duration::from_secs(5));
}

#[test]
fn interrupt_sends_turn_interrupt_and_the_turn_ends_as_interrupted() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let driver = fx.driver();
    working(&driver);
    assert!(!driver.is_idle());
    driver.interrupt().unwrap();
    let interrupt = fx.wait_for_method("turn/interrupt");
    assert_eq!(
        interrupt["params"],
        json!({"threadId": "fake-thread", "turnId": "turn-1"})
    );
    events_until(&driver, |e| {
        e == &DriverEvent::TurnEnded(TurnOutcome::Interrupted)
    });
    assert!(driver.is_idle());
    driver.stop(Duration::from_secs(5));
}

#[test]
fn a_message_while_a_turn_runs_steers_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let driver = fx.driver();
    working(&driver);
    driver.send_user_message("also this").unwrap();
    let steer = fx.wait_for_method("turn/steer")["params"].clone();
    assert_eq!(steer["expectedTurnId"], "turn-1");
    assert_eq!(steer["input"][0]["text"], "also this");
    let turns = fx
        .received()
        .iter()
        .filter(|line| line["method"] == "turn/start")
        .count();
    assert_eq!(turns, 1);
    driver.stop(Duration::from_secs(5));
}

#[test]
fn a_codex_session_that_ignores_its_closed_input_is_still_ended() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("stubborn"), "").unwrap();
    let launched = fx.launch(Tool::Codex, None).unwrap();
    fx.wait_for_method("turn/start");
    assert!(fx.launcher.stop().unwrap());
    assert!(!alive(launched.pid));
    assert!(fx.launcher.status().is_empty());
}
