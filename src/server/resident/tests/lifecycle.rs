use super::*;

#[test]
fn stop_ends_the_process_drops_the_registry_entry_and_allows_a_relaunch() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let launched = fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    // The session's wait has registered, and its stream is still open.
    let _hold = fx.registry.register(Attributes {
        project: project(),
        key: "resident:abc".into(),
        tool: Tool::ClaudeCode,
        origin: Origin::Board,
    });
    assert!(fx.registry.check_board_launch(Tool::ClaudeCode).is_err());

    assert!(fx.launcher.stop(Tool::ClaudeCode).unwrap());
    assert!(!alive(launched.pid));
    assert!(fx.launcher.status().is_empty());
    assert!(fx.registry.check_board_launch(Tool::ClaudeCode).is_ok());
    assert!(!fx.launcher.stop(Tool::ClaudeCode).unwrap());

    std::fs::remove_file(fx.dir.path().join("claude.record")).unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    fx.record("claude");
    fx.launcher.shutdown();
}

#[test]
fn a_child_that_exits_by_itself_is_reaped_and_forgotten() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    std::fs::write(fx.dir.path().join("exit-now"), "").unwrap();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    // Its own session registers, then the process dies.
    let _hold2 = fx.registry.register(Attributes {
        project: project(),
        key: "resident:def".into(),
        tool: Tool::ClaudeCode,
        origin: Origin::Board,
    });
    wait_until("the exit to be noticed", || fx.launcher.status().is_empty());
    wait_until("the registry entry to go", || {
        fx.registry.check_board_launch(Tool::ClaudeCode).is_ok()
    });
}

#[test]
fn a_missing_command_and_a_logged_out_one_are_told_apart() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let missing = Launcher::new(
        fx.registry.clone(),
        Executables::fixed(None, None),
        fx.dir.path(),
    );
    let error = missing
        .launch(&project(), "demo", fx.folder.path(), Tool::ClaudeCode, None)
        .unwrap_err();
    assert_eq!(error.code(), "agent_cli_missing");

    std::fs::write(fx.dir.path().join("logged-out"), "").unwrap();
    for tool in [Tool::ClaudeCode, Tool::Codex] {
        let error = fx.launch(tool, None).unwrap_err();
        assert_eq!(error.code(), "agent_cli_logged_out", "{tool:?}");
    }
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn models_come_from_the_tool_and_fall_back_to_an_empty_list_with_a_reason() {
    let fx = fixture();
    let claude = fx.launcher.models(Tool::ClaudeCode).unwrap();
    let ids: Vec<&str> = claude.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["opus", "sonnet", "haiku", "fable"]);
    assert!(claude.reason.is_none());

    let codex = fx.launcher.models(Tool::Codex).unwrap();
    assert_eq!(codex.models.len(), 1);
    assert_eq!(codex.models[0].id, "gpt-a");

    std::fs::write(fx.dir.path().join("models.json"), "nope").unwrap();
    let fallback = fx.launcher.models(Tool::Codex).unwrap();
    assert!(fallback.models.is_empty());
    assert!(fallback.reason.is_some());
    assert_eq!(
        fx.launcher.models(Tool::Unknown).unwrap_err().code(),
        "invalid_value"
    );
}

#[test]
fn a_model_that_is_not_offered_or_not_a_name_is_refused() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    for model in ["--help", "gpt-hidden"] {
        let error = fx.launch(Tool::Codex, Some(model)).unwrap_err();
        assert_eq!(error.code(), "invalid_value", "{model}");
    }
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn shutdown_stops_every_child() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let a = fx.launch(Tool::ClaudeCode, None).unwrap();
    let b = fx.launch(Tool::Codex, None).unwrap();
    fx.record("claude");
    fx.record("codex");
    fx.launcher.shutdown();
    assert!(!alive(a.pid));
    assert!(!alive(b.pid));
    assert!(fx.launcher.status().is_empty());
}
