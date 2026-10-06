//! The hook templates name their project in a fixed command, for every event,
//! and carry nothing machine-specific.

use std::process::Command;

use serde_json::Value;

const PLACEHOLDER: &str = "PROJECT_NAME";

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

/// The quoting rule the integration guide gives for a project name.
fn shell_quote(name: &str) -> String {
    format!("'{}'", name.replace('\'', "'\\''"))
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
fn every_template_command_names_the_project_and_is_fixed() {
    for (agent, template) in [("claude", claude()), ("codex", codex())] {
        for (event, hook) in handlers(&template) {
            let expected = format!(
                "agboard --project {} hook --agent {agent}",
                shell_quote(PLACEHOLDER)
            );
            assert_eq!(command(&hook), expected, "{agent} {event}");
            assert_eq!(hook["type"], "command");
            assert_eq!(hook["timeout"], 10, "{agent} {event}");
            if agent == "codex" {
                assert_eq!(hook["additionalContextLimit"], 0, "{event}");
            }
            // Nothing is substituted: no variables, command substitution,
            // chaining, or redirection.
            for forbidden in ["$", "`", ";", "&", "|", "<", ">", "\n"] {
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

/// The shell receives the project name as one argument and runs nothing else,
/// however odd the name is. A fake `agboard` records its arguments.
#[cfg(unix)]
#[test]
fn a_quoted_project_name_reaches_the_command_as_one_word() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("arguments");
    let marker = dir.path().join("injected");
    let script = dir.path().join("agboard");
    std::fs::write(
        &script,
        "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\" >> \"$RECORD\"; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let hostile = format!(
        "it's $(touch {m}); `touch {m}` \"q\" \\ & {m}",
        m = marker.display()
    );
    for (agent, template) in [("claude", claude()), ("codex", codex())] {
        for (event, hook) in handlers(&template) {
            let line = command(&hook).replace(&shell_quote(PLACEHOLDER), &shell_quote(&hostile));
            std::fs::write(&record, "").unwrap();
            let path = format!(
                "{}:{}",
                dir.path().display(),
                std::env::var("PATH").unwrap()
            );
            let status = Command::new("sh")
                .args(["-c", &line])
                .env("PATH", path)
                .env("RECORD", &record)
                .status()
                .unwrap();
            assert!(status.success(), "{agent} {event}");
            let recorded = std::fs::read_to_string(&record).unwrap();
            let words: Vec<&str> = recorded.lines().collect();
            assert_eq!(
                words,
                vec!["--project", hostile.as_str(), "hook", "--agent", agent],
                "{agent} {event}"
            );
            assert!(!marker.exists(), "the name was executed");
        }
    }
}
