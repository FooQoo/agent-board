//! Hook templates infer the project from the hook's working directory and
//! carry no runtime or machine-specific values.

use serde_json::Value;

fn claude() -> Value {
    serde_json::from_str(include_str!("../integrations/claude-code/settings.json")).unwrap()
}

fn codex() -> Value {
    serde_json::from_str(include_str!("../integrations/codex/hooks.json")).unwrap()
}

/// Every `(event, handler)` of a template.
fn handlers(template: &Value) -> Vec<(String, Value)> {
    let mut found = Vec::new();
    for (event, entries) in template["hooks"].as_object().unwrap() {
        for entry in entries.as_array().unwrap() {
            for hook in entry["hooks"].as_array().unwrap() {
                found.push((event.clone(), hook.clone()));
            }
        }
    }
    found
}

fn command(hook: &Value) -> &str {
    hook["command"].as_str().unwrap()
}

#[test]
fn templates_cover_the_documented_events() {
    let mut claude_events: Vec<String> = handlers(&claude()).into_iter().map(|h| h.0).collect();
    claude_events.sort();
    assert_eq!(
        claude_events,
        ["PostToolUse", "PostToolUseFailure", "SessionStart"]
    );
    let mut codex_events: Vec<String> = handlers(&codex()).into_iter().map(|h| h.0).collect();
    codex_events.sort();
    assert_eq!(codex_events, ["PostToolUse", "SessionStart"]);
}

#[test]
fn every_template_command_uses_cwd_resolution_and_is_fixed() {
    for (agent, template) in [("claude", claude()), ("codex", codex())] {
        for (event, hook) in handlers(&template) {
            let expected = format!("agboard hook --agent {agent}");
            assert_eq!(command(&hook), expected, "{agent} {event}");
            assert_eq!(hook["type"], "command");
            assert_eq!(hook["timeout"], 10, "{agent} {event}");
            if agent == "codex" {
                assert_eq!(hook["additionalContextLimit"], 0, "{event}");
            }
            for forbidden in [
                "PROJECT_NAME",
                "session_id",
                "sessionId",
                "$",
                "`",
                ";",
                "&",
                "|",
                "<",
                ">",
                "\n",
            ] {
                assert!(
                    !command(&hook).contains(forbidden),
                    "{agent} {event} contains {forbidden:?}"
                );
            }
        }
    }
}

#[test]
fn templates_hold_no_personal_or_machine_specific_paths() {
    for text in [
        include_str!("../integrations/claude-code/settings.json"),
        include_str!("../integrations/codex/hooks.json"),
        include_str!("../integrations/README.md"),
    ] {
        for personal in [
            "/Users/",
            "/home/",
            "C:\\Users",
            "target/debug",
            "target/release",
        ] {
            assert!(!text.contains(personal), "found {personal}");
        }
    }
}

#[test]
fn the_skill_sends_an_unbound_folder_to_the_users_own_connect_run() {
    for (name, text) in [
        (
            "SKILL.md",
            include_str!("../.agents/skills/agent-board/SKILL.md"),
        ),
        (
            "listening.md",
            include_str!("../.agents/skills/agent-board/references/listening.md"),
        ),
    ] {
        assert!(
            text.contains("folder_unbound"),
            "{name} omits folder_unbound"
        );
        assert!(text.contains("agboard connect"), "{name} omits connect");
    }
    let skill = include_str!("../.agents/skills/agent-board/SKILL.md");
    assert!(
        skill.contains("never run it"),
        "the Skill must not run connect itself"
    );
    assert!(
        skill.contains("interactive"),
        "the Skill must say connect is interactive"
    );
    // connect takes no confirmation-skipping or machine-readable options.
    for forbidden in ["connect --yes", "connect --json", "connect --dry-run"] {
        assert!(!skill.contains(forbidden), "found {forbidden}");
    }
}

#[test]
fn the_skill_registers_a_breakdown_only_after_the_user_agrees() {
    let skill = include_str!("../.agents/skills/agent-board/SKILL.md");
    assert!(
        skill.contains("Break a request into tasks, and register them only after a yes"),
        "the Skill must break a request down before registering it"
    );
    assert!(
        skill.contains(
            "Silence, a timeout, an unclear reply, or a request for changes is not a yes"
        ),
        "the Skill must register only on an explicit yes"
    );
}
