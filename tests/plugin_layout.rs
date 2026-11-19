//! The repository is the plugin marketplace of Codex and Claude Code: both
//! catalogs name one shared plugin folder, every version in them is the crate
//! version (setup installs the plugin from the tag `v<version>`), the Hook
//! commands carry no version, and the Skill is a thin entry that runs
//! `agboard skills`.

use std::path::{Path, PathBuf};

use serde_json::Value;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(path)
}

fn json(path: &str) -> Value {
    let text = std::fs::read_to_string(repo(path)).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

#[test]
fn both_catalogs_name_the_shared_plugin_folder() {
    let codex = json(".agents/plugins/marketplace.json");
    let claude = json(".claude-plugin/marketplace.json");
    assert_eq!(codex["name"], "agent-board");
    assert_eq!(claude["name"], "agent-board");
    let codex_plugins = codex["plugins"].as_array().unwrap();
    let claude_plugins = claude["plugins"].as_array().unwrap();
    assert_eq!(codex_plugins.len(), 1);
    assert_eq!(claude_plugins.len(), 1);
    assert_eq!(codex_plugins[0]["name"], "agent-board");
    assert_eq!(codex_plugins[0]["source"]["source"], "local");
    assert_eq!(codex_plugins[0]["source"]["path"], "./plugins/agent-board");
    assert_eq!(claude_plugins[0]["name"], "agent-board");
    assert_eq!(claude_plugins[0]["source"], "./plugins/agent-board");

    let codex_manifest = json("plugins/agent-board/.codex-plugin/plugin.json");
    assert_eq!(codex_manifest["skills"], "./skills/");
    assert_eq!(codex_manifest["hooks"], "./hooks/codex.json");
    let claude_manifest = json("plugins/agent-board/.claude-plugin/plugin.json");
    assert_eq!(claude_manifest["hooks"], "./hooks/claude.json");
    for manifest in [codex_manifest, claude_manifest] {
        assert_eq!(manifest["name"], "agent-board");
    }
    assert!(repo("plugins/agent-board/skills/agent-board/SKILL.md").is_file());
}

#[test]
fn every_plugin_version_is_the_crate_version() {
    for (path, pointer) in [
        ("plugins/agent-board/.codex-plugin/plugin.json", "/version"),
        ("plugins/agent-board/.claude-plugin/plugin.json", "/version"),
        (".claude-plugin/marketplace.json", "/plugins/0/version"),
    ] {
        assert_eq!(
            json(path).pointer(pointer).and_then(Value::as_str),
            Some(VERSION),
            "{path}: set the version to {VERSION} when the crate version changes"
        );
    }
    let expected = |agent: &str| format!("agboard hook --agent {agent}");
    for (path, agent) in [
        ("plugins/agent-board/hooks/claude.json", "claude"),
        ("plugins/agent-board/hooks/codex.json", "codex"),
    ] {
        let hooks = json(path);
        let mut commands = Vec::new();
        for entries in hooks["hooks"].as_object().unwrap().values() {
            for entry in entries.as_array().unwrap() {
                for hook in entry["hooks"].as_array().unwrap() {
                    commands.push(hook["command"].as_str().unwrap().to_string());
                }
            }
        }
        assert!(!commands.is_empty(), "{path}");
        for command in commands {
            assert_eq!(command, expected(agent), "{path}");
        }
    }
}

#[test]
fn the_skill_is_a_thin_entry_that_runs_agboard_skills() {
    let skill_dir = repo("plugins/agent-board/skills/agent-board");
    let skill = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    let (frontmatter, body) = skill
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
        .expect("SKILL.md has frontmatter");
    for key in ["name: agent-board\n", "description: ", "compatibility: "] {
        assert!(frontmatter.contains(key), "the frontmatter omits {key}");
    }
    assert!(frontmatter.contains("\nallowed-tools: Bash(agboard *)"));
    // The one line Claude Code replaces with the command's output.
    assert!(body.lines().any(|line| line == "!`agboard skills`"));
    assert!(body.contains("run `agboard skills` and follow its output"));
    assert!(
        body.len() < 400,
        "the entry holds instructions; they belong in the binary"
    );
    // The instructions and their references are served by the binary.
    let entries: Vec<_> = std::fs::read_dir(&skill_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(
        entries,
        ["SKILL.md"],
        "the plugin ships no references or assets"
    );
}

#[test]
fn the_plugin_holds_no_links_or_machine_specific_paths() {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let meta = std::fs::symlink_metadata(&path).unwrap();
            assert!(!meta.file_type().is_symlink(), "{path:?} is a link");
            if meta.is_dir() {
                walk(&path, out);
            } else {
                out.push(path);
            }
        }
    }
    let mut files = vec![
        repo(".agents/plugins/marketplace.json"),
        repo(".claude-plugin/marketplace.json"),
    ];
    walk(&repo("plugins/agent-board"), &mut files);
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        for personal in ["/Users/", "/home/", "C:\\Users", "target/debug"] {
            assert!(!text.contains(personal), "{file:?} contains {personal}");
        }
    }
}

#[test]
fn the_remote_skill_hands_out_the_address_without_starting_anything() {
    let path = repo("plugins/agent-board/skills/remote/SKILL.md");
    let skill = std::fs::read_to_string(path).unwrap();
    assert!(skill.starts_with("---\nname: remote\n"));
    for needed in [
        "agboard progress --json",
        "agboard --project \"<name>\" remote --json",
        "`ready`",
        "anyone who can read this chat",
        "remote_unavailable",
        "Never ask for, print, or store the ngrok token",
        "Never start `agboard serve`",
    ] {
        assert!(skill.contains(needed), "the remote Skill omits {needed}");
    }
}

#[test]
fn the_wait_skill_keeps_listening_after_an_idle_timeout() {
    let path = repo("plugins/agent-board/skills/wait/SKILL.md");
    let skill = std::fs::read_to_string(path).unwrap();
    assert!(skill.starts_with("---\nname: wait\n"));
    for needed in [
        "allowed-tools: Bash(agboard *)",
        "agboard skills resident",
        "idle_timeout",
        "3600",
        "board_unavailable",
        "local_network_denied",
        "project_not_found",
    ] {
        assert!(skill.contains(needed), "the wait Skill omits {needed}");
    }
}
