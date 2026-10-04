use serde_json::Value;

fn handler<'a>(value: &'a Value, event: &str, index: usize) -> &'a Value {
    &value["hooks"][event][index]["hooks"][0]
}

#[test]
fn agent_hook_templates_use_fixed_commands_and_reviewable_limits() {
    let codex: Value =
        serde_json::from_str(include_str!("../integrations/codex/hooks.json")).unwrap();
    for (event, index) in [("PostToolUse", 0), ("SessionStart", 0)] {
        let hook = handler(&codex, event, index);
        assert_eq!(hook["command"], "agboard hook --agent codex");
        assert_eq!(hook["timeout"], 10);
        assert_eq!(hook["additionalContextLimit"], 0);
    }
    let claude: Value =
        serde_json::from_str(include_str!("../integrations/claude-code/settings.json")).unwrap();
    assert_eq!(
        handler(&claude, "SessionStart", 0)["command"],
        "agboard hook --agent claude"
    );
    assert_eq!(handler(&claude, "SessionStart", 0)["timeout"], 10);
}
