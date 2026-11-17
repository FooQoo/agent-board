//! Hook templates infer the project from the hook's working directory and
//! carry no runtime or machine-specific values.

use serde_json::Value;

fn claude() -> Value {
    serde_json::from_str(include_str!("../plugins/agent-board/hooks/claude.json")).unwrap()
}

fn codex() -> Value {
    serde_json::from_str(include_str!("../plugins/agent-board/hooks/codex.json")).unwrap()
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
            let expected = format!(
                "agboard hook --agent {agent} --plugin-version {}",
                env!("CARGO_PKG_VERSION")
            );
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
        include_str!("../plugins/agent-board/hooks/claude.json"),
        include_str!("../plugins/agent-board/hooks/codex.json"),
        include_str!("../plugins/agent-board/README.md"),
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
fn the_skill_sends_an_unbound_folder_to_the_users_own_setup_run() {
    for (name, text) in [
        (
            "SKILL.md",
            include_str!("../plugins/agent-board/skills/agent-board/SKILL.md"),
        ),
        (
            "listening.md",
            include_str!("../plugins/agent-board/skills/agent-board/references/listening.md"),
        ),
    ] {
        assert!(
            text.contains("folder_unbound"),
            "{name} omits folder_unbound"
        );
        assert!(text.contains("agboard setup"), "{name} omits setup");
        assert!(!text.contains("agboard connect"), "{name} names connect");
    }
    let skill = include_str!("../plugins/agent-board/skills/agent-board/SKILL.md");
    assert!(
        skill.contains("never run it"),
        "the Skill must not run setup itself"
    );
    assert!(
        skill.contains("confirm in a terminal"),
        "the Skill must say setup asks the user in a terminal"
    );
    // The Skill never offers the options that skip the user's confirmation.
    for forbidden in ["setup --yes", "setup --json", "update --yes"] {
        assert!(!skill.contains(forbidden), "found {forbidden}");
    }
}

#[test]
fn the_skill_plans_first_and_starts_after_one_approval() {
    let skill = include_str!("../plugins/agent-board/skills/agent-board/SKILL.md");
    // A request becomes a provisional plan on the board before any question.
    assert!(
        skill.contains("put a provisional plan on the board first"),
        "the Skill must register a provisional plan first"
    );
    assert!(
        skill.contains("Do not ask before registering it"),
        "the Skill must not ask before registering the plan"
    );
    // Plan questions come first; the user then starts the AI drafts.
    assert!(
        skill.contains("**Ask the plan questions.**")
            && skill.contains("**Wait for the start.**")
            && skill.find("**Ask the plan questions.**") < skill.find("**Wait for the start.**"),
        "the Skill must ask plan questions before the start"
    );
    assert!(skill.contains("With no plan questions, go to step 5"));
    // The plan's tasks are AI drafts that a person starts.
    for needed in ["agboard epic start", "agboard start"] {
        assert!(skill.contains(needed), "the Skill omits {needed}");
    }
    assert!(!skill.contains("start_approval") && !skill.contains("approvingChoiceIds"));
    // After the start, only four cases call the user.
    for case in [
        "**Intent**",
        "**Preference**",
        "**cannot be undone**",
        "**scope**",
    ] {
        assert!(skill.contains(case), "the Skill omits the case {case}");
    }
    // The old flow that registered only after a yes in the chat is gone.
    assert!(!skill.contains("register them only after a yes"));
    assert!(!skill.contains("Do not ask in chat"));
}

#[test]
fn the_skill_asks_on_the_board_and_in_the_chat() {
    let skill = include_str!("../plugins/agent-board/skills/agent-board/SKILL.md");
    assert!(
        skill.contains("Every question goes on the board with `message ask`, never only in chat"),
        "every question must go to the board"
    );
    assert!(
        skill.contains("Do not use your agent's question tool"),
        "the Skill must keep the agent's question tool out of a conversation"
    );
    assert!(
        skill.contains("show the question in the chat as plain text"),
        "the question must be shown in the chat as plain text"
    );
    assert!(
        skill.contains("never ask the same question again in the other place"),
        "an answered question must not be asked again in the other channel"
    );
    assert!(
        skill.contains("in the language the user speaks with you"),
        "chat replies must follow the user's language"
    );
    assert!(
        skill.contains("message answer <Q-id> --actor human --via chat"),
        "a chat answer must be written back to the board"
    );
    assert!(skill.contains("question_answered"));
    assert!(
        skill.contains("message wait <Q-id>"),
        "the Skill must wait again after a timeout"
    );
    assert!(
        skill.contains("Never ask the same questions a second time"),
        "a re-wait must not ask again"
    );
}
