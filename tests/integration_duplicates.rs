//! Reading the `agboard` Hooks of a Codex `config.toml`: the trust records
//! Codex keeps under `[hooks.state]` are not Hook events.

use agent_board::integrations::duplicates::scan_file;

#[test]
fn codex_trust_records_under_hooks_state_are_not_hook_events() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    std::fs::write(
        &config,
        r#"sandbox_mode = "workspace-write"

[[hooks.SessionStart]]
matcher = "startup"
[[hooks.SessionStart.hooks]]
type = "command"
command = "agboard hook --agent codex"

[hooks.state."/work/.codex/hooks.json:post_tool_use:0:0"]
trusted_hash = "sha256:00"
"#,
    )
    .unwrap();
    let found = scan_file(&config).unwrap();
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].event, "SessionStart");
}

#[test]
fn a_config_with_only_trust_records_has_no_agboard_hooks() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config.toml");
    std::fs::write(
        &config,
        "[hooks.state.\"/work/.codex/hooks.json:session_start:0:0\"]\ntrusted_hash = \"sha256:00\"\n",
    )
    .unwrap();
    assert!(scan_file(&config).unwrap().is_empty());
}
