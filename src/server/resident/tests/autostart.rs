//! Auto-start at server start, and the file that holds the choice.

use super::health::{fast, no_projects, state_of};
use super::*;

fn choice(tool: Tool, model: Option<&str>) -> Option<AutoStart> {
    Some(AutoStart {
        tool,
        project_id: project(),
        model: model.map(str::to_string),
    })
}

#[test]
fn auto_start_launches_the_saved_session_when_the_server_starts() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(choice(Tool::ClaudeCode, Some("sonnet")))
        .unwrap();
    let folder = fx.folder.path().to_path_buf();
    fx.launcher
        .start(move |_| Ok(("demo".to_string(), folder.clone())));
    assert!(fx.record("claude").contains("--model sonnet"));
    wait_until("the running state", || {
        state_of(&fx, Tool::ClaudeCode).state == HealthState::Running
    });
    let health = state_of(&fx, Tool::ClaudeCode);
    assert_eq!(health.tool, Some(Tool::ClaudeCode));
    assert_eq!(health.auto_start.unwrap().model.as_deref(), Some("sonnet"));
    assert_eq!(fx.launcher.status().len(), 1);
    fx.launcher.shutdown();
}

#[test]
fn a_failing_auto_start_shows_as_failed_and_does_not_block_the_start() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    std::fs::write(fx.dir.path().join("logged-out"), "").unwrap();
    fx.launcher
        .autostart()
        .set(choice(Tool::Codex, None))
        .unwrap();
    let folder = fx.folder.path().to_path_buf();
    let started = Instant::now();
    fx.launcher
        .start(move |_| Ok(("demo".to_string(), folder.clone())));
    assert!(started.elapsed() < Duration::from_secs(2));
    wait_until("the failed state", || {
        state_of(&fx, Tool::Codex).state == HealthState::Failed
    });
    let health = state_of(&fx, Tool::Codex);
    assert_eq!(health.tool, Some(Tool::Codex));
    assert!(health.reason.unwrap().contains("Log in to"));
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn an_auto_start_whose_project_is_gone_fails_with_the_reason() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture_timed(fast());
    fx.launcher
        .autostart()
        .set(choice(Tool::Codex, None))
        .unwrap();
    fx.launcher.start(no_projects);
    wait_until("the failed state", || {
        state_of(&fx, Tool::Codex).state == HealthState::Failed
    });
    assert!(state_of(&fx, Tool::Codex).reason.is_some());
    assert_eq!(state_of(&fx, Tool::Codex).project_id, Some(project()));
}

#[test]
fn the_autostart_file_round_trips_clears_and_ignores_format_1() {
    let fx = fixture();
    let store = fx.launcher.autostart();
    let path = fx.dir.path().join("data/.internal/resident-autostart.json");
    assert_eq!(store.get(), None);
    store.set(choice(Tool::Codex, None)).unwrap();
    assert_eq!(store.get(), choice(Tool::Codex, None));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("\"formatVersion\": 2"), "{text}");
    store.set(None).unwrap();
    assert_eq!(store.get(), None);
    std::fs::write(&path, "nope").unwrap();
    assert_eq!(store.get(), None);
    std::fs::write(
        &path,
        r#"{"formatVersion":1,"tools":{"codex":{"projectId":"0123456789abcdef0123456789abcdef","model":null}}}"#,
    )
    .unwrap();
    assert_eq!(store.get(), None);
}
