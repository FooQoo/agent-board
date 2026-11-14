//! `agboard setup` and `agboard update`: installing the Agent Board plugin with
//! the agents' own commands, trusting the Codex hooks, and what happens when
//! an agent is missing or a command fails. The agents are the fakes of
//! `support/fake_agents.rs`, the only commands on PATH, so nothing reaches a
//! real agent or the network.

#[path = "support/fake_agents.rs"]
mod fake_agents;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use fake_agents::{FakeAgents, PLUGIN};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const REPOSITORY: &str = "https://github.com/FooQoo/agent-board.git";

struct Fixture {
    _tmp: tempfile::TempDir,
    home: PathBuf,
    fakes: FakeAgents,
}

/// A home with a workspace-write Codex config, and fakes for `agents`.
fn fixture(agents: &[&str]) -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    fs::create_dir_all(home.join(".codex")).unwrap();
    fs::write(
        home.join(".codex/config.toml"),
        "sandbox_mode = \"workspace-write\"\n",
    )
    .unwrap();
    let fakes = FakeAgents::new(tmp.path(), agents);
    Fixture {
        _tmp: tmp,
        home,
        fakes,
    }
}

impl Fixture {
    fn run(&self, extra: &[(&str, &str)], args: &[&str]) -> (i32, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_agboard"))
            .env_clear()
            .env("HOME", &self.home)
            .env("PATH", &self.fakes.bin)
            .env("TZ", "UTC")
            .env("AGBOARD_AUTOSTART", "0")
            .env("AGBOARD_OPEN_BROWSER", "0")
            .current_dir(&self.home)
            .args(args)
            .envs(extra.iter().copied())
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        (
            output.status.code().unwrap(),
            String::from_utf8(output.stdout).unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    }

    /// Runs with `--json` and returns the exit code and the parsed output.
    fn json(&self, extra: &[(&str, &str)], args: &[&str]) -> (i32, Value) {
        let mut all = vec!["--json"];
        all.extend_from_slice(args);
        let (code, out, err) = self.run(extra, &all);
        let value = serde_json::from_str(&out).unwrap_or_else(|_| panic!("{out}\n{err}"));
        (code, value)
    }

    fn agent<'a>(&self, json: &'a Value, name: &str) -> &'a Value {
        json["agents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["agent"] == name)
            .unwrap_or_else(|| panic!("{name} missing in {json}"))
    }
}

#[test]
fn setup_installs_the_plugin_from_the_release_tag_with_each_agents_commands() {
    let fx = fixture(&["codex", "claude"]);
    let (code, json) = fx.json(&[], &["setup", "--agent", "all", "--yes"]);
    assert_eq!(code, 0, "{json}");
    let tag = format!("v{VERSION}");
    assert_eq!(
        fx.fakes.log("codex")[..3],
        [
            "plugin list --json".to_string(),
            format!("plugin marketplace add {REPOSITORY} --ref {tag} --json"),
            format!("plugin add {PLUGIN} --json"),
        ]
    );
    assert_eq!(
        fx.fakes.log("claude"),
        [
            "plugin list --json".to_string(),
            format!("plugin marketplace add {REPOSITORY}#{tag} --json"),
            format!("plugin install {PLUGIN} --json"),
            format!("plugin update {PLUGIN} --json"),
        ]
    );
    for name in ["codex", "claude"] {
        let agent = fx.agent(&json, name);
        assert_eq!(agent["status"], "updated");
        assert_eq!(agent["plugin"]["installedVersion"], Value::Null);
        assert_eq!(agent["plugin"]["version"], VERSION);
        assert_eq!(fx.fakes.installed(name).as_deref(), Some(VERSION));
    }
}

#[test]
fn setup_trusts_only_the_agent_board_hooks_in_codex() {
    let fx = fixture(&["codex"]);
    let (code, json) = fx.json(&[], &["setup", "--agent", "codex", "--yes"]);
    assert_eq!(code, 0, "{json}");
    assert_eq!(fx.agent(&json, "codex")["trustedHooks"], 2);
    assert_eq!(fx.fakes.log("codex").last().unwrap(), "app-server");
    let writes = fx.fakes.trust_writes();
    assert_eq!(writes.len(), 1);
    let params = &writes[0]["params"];
    assert_eq!(params["keyPath"], "hooks.state");
    assert_eq!(params["mergeStrategy"], "upsert");
    let value = params["value"].as_object().unwrap();
    assert_eq!(value.len(), 2, "{value:?}");
    for (key, state) in value {
        assert!(key.starts_with("agent-board@agent-board:"), "{key}");
        assert!(
            state["trusted_hash"]
                .as_str()
                .unwrap()
                .starts_with("sha256:")
        );
    }
}

#[test]
fn hooks_that_are_trusted_already_are_not_written_again() {
    let fx = fixture(&["codex"]);
    fx.fakes.preinstall(
        "codex",
        VERSION,
        &format!("{REPOSITORY} --ref v{VERSION} --json"),
    );
    fx.fakes.trust();
    let (code, json) = fx.json(&[], &["setup", "--agent", "codex", "--yes"]);
    assert_eq!(code, 0, "{json}");
    assert_eq!(fx.agent(&json, "codex")["trustedHooks"], 0);
    assert!(fx.fakes.trust_writes().is_empty());
    // The plugin of this version is installed, so no plugin command ran.
    assert_eq!(fx.fakes.log("codex"), ["plugin list --json", "app-server"]);
}

#[test]
fn the_marketplace_override_installs_from_another_place_without_a_tag() {
    let fx = fixture(&["claude"]);
    let local = fx.home.parent().unwrap().join("checkout");
    let (code, _json) = fx.json(
        &[("AGBOARD_PLUGIN_MARKETPLACE", local.to_str().unwrap())],
        &["setup", "--agent", "claude", "--yes"],
    );
    assert_eq!(code, 0);
    assert_eq!(
        fx.fakes.log("claude")[1],
        format!("plugin marketplace add {} --json", local.display())
    );
}

#[test]
fn a_missing_agent_command_is_reported_and_the_other_agent_is_set_up() {
    let fx = fixture(&["claude"]);
    let (code, json) = fx.json(&[], &["setup", "--agent", "all", "--yes"]);
    assert_eq!(code, 0, "{json}");
    let codex = fx.agent(&json, "codex");
    assert_eq!(codex["status"], "skipped");
    assert!(
        codex["reason"]
            .as_str()
            .unwrap()
            .contains("codex command was not found on PATH"),
        "{codex}"
    );
    assert!(codex["files"].as_array().unwrap().is_empty());
    assert!(!fx.home.join(".codex/rules").exists());
    assert_eq!(fx.agent(&json, "claude")["status"], "updated");
}

#[test]
fn setup_fails_when_no_agent_command_is_found() {
    let fx = fixture(&[]);
    let (code, json) = fx.json(&[], &["setup", "--agent", "all", "--yes"]);
    assert_eq!(code, 1, "{json}");
    for name in ["codex", "claude"] {
        assert_eq!(fx.agent(&json, name)["status"], "skipped");
    }
    let (code, out, _err) = fx.run(&[], &["setup", "--agent", "codex", "--yes"]);
    assert_eq!(code, 1);
    assert!(out.contains("Codex: skipped"), "{out}");
}

#[test]
fn a_failing_agent_command_fails_that_agent_with_its_message() {
    let fx = fixture(&["codex", "claude"]);
    fx.fakes.fail("claude", "plugin marketplace add");
    let (code, json) = fx.json(&[], &["setup", "--agent", "all", "--yes"]);
    assert_eq!(code, 1, "{json}");
    let claude = fx.agent(&json, "claude");
    assert_eq!(claude["status"], "failed");
    let reason = claude["reason"].as_str().unwrap();
    assert!(reason.contains("claude plugin marketplace add"), "{reason}");
    assert!(reason.contains("network is unreachable"), "{reason}");
    assert!(fx.fakes.installed("claude").is_none());
    // The other agent and the settings files are not affected.
    assert_eq!(fx.agent(&json, "codex")["status"], "updated");
    assert!(
        fs::read_to_string(fx.home.join(".claude/settings.json"))
            .unwrap()
            .contains(".agent-board")
    );
}

#[test]
fn without_a_terminal_setup_needs_an_agent_and_a_yes_or_a_dry_run() {
    let fx = fixture(&["codex", "claude"]);
    for args in [
        &["setup", "--yes"][..],
        &["setup", "--agent", "codex"],
        &["update"],
        &["--json", "setup", "--agent", "codex"],
    ] {
        let (code, _out, err) = fx.run(&[], args);
        assert_eq!(code, 2, "{args:?}: {err}");
        assert!(err.contains("terminal"), "{err}");
    }
    assert!(fx.fakes.log("codex").is_empty(), "nothing may run");
    assert!(!fx.home.join(".agent-board").exists());
}

#[test]
fn dry_run_runs_only_the_read_only_plugin_list() {
    let fx = fixture(&["codex", "claude"]);
    let before = fs::read(fx.home.join(".codex/config.toml")).unwrap();
    let (code, json) = fx.json(&[], &["setup", "--agent", "all", "--dry-run"]);
    assert_eq!(code, 0, "{json}");
    for name in ["codex", "claude"] {
        assert_eq!(fx.fakes.log(name), ["plugin list --json"], "{name}");
        assert_eq!(fx.agent(&json, name)["status"], "planned");
    }
    let action = fx.agent(&json, "codex")["plugin"]["action"]
        .as_str()
        .unwrap();
    assert!(action.starts_with("install version"), "{action}");
    assert_eq!(
        fs::read(fx.home.join(".codex/config.toml")).unwrap(),
        before
    );
    assert!(!fx.home.join(".codex/rules").exists());
    assert!(!fx.home.join(".agent-board").exists());
}

fn old_install(fx: &Fixture) {
    fx.fakes.preinstall(
        "codex",
        "0.0.1",
        &format!("{REPOSITORY} --ref v0.0.1 --json"),
    );
    fx.fakes
        .preinstall("claude", "0.0.1", &format!("{REPOSITORY}#v0.0.1 --json"));
    fx.fakes.trust();
}

#[test]
fn update_moves_the_marketplace_to_this_tag_and_trusts_the_hooks_again() {
    let fx = fixture(&["codex", "claude"]);
    old_install(&fx);
    let (code, json) = fx.json(&[], &["update", "--yes"]);
    assert_eq!(code, 0, "{json}");
    let tag = format!("v{VERSION}");
    assert_eq!(
        fx.fakes.log("codex"),
        [
            "plugin list --json".to_string(),
            format!("plugin marketplace add {REPOSITORY} --ref {tag} --json"),
            "plugin marketplace remove agent-board --json".to_string(),
            format!("plugin marketplace add {REPOSITORY} --ref {tag} --json"),
            format!("plugin add {PLUGIN} --json"),
            "app-server".to_string(),
        ]
    );
    assert_eq!(
        fx.fakes.log("claude")[2..4],
        [
            "plugin marketplace remove agent-board --json".to_string(),
            format!("plugin marketplace add {REPOSITORY}#{tag} --json"),
        ]
    );
    for name in ["codex", "claude"] {
        let agent = fx.agent(&json, name);
        assert_eq!(agent["status"], "updated");
        assert_eq!(agent["plugin"]["installedVersion"], "0.0.1");
        assert_eq!(fx.fakes.installed(name).as_deref(), Some(VERSION));
        // update touches no settings file
        assert!(agent["files"].as_array().unwrap().is_empty());
    }
    assert_eq!(fx.agent(&json, "codex")["trustedHooks"], 2);
    assert!(!fx.home.join(".claude").exists());
}

#[test]
fn update_skips_an_agent_without_the_plugin() {
    let fx = fixture(&["codex", "claude"]);
    fx.fakes
        .preinstall("claude", "0.0.1", &format!("{REPOSITORY}#v0.0.1 --json"));
    let (code, json) = fx.json(&[], &["update", "--yes"]);
    assert_eq!(code, 0, "{json}");
    let codex = fx.agent(&json, "codex");
    assert_eq!(codex["status"], "skipped");
    assert!(codex["reason"].as_str().unwrap().contains("agboard setup"));
    assert_eq!(fx.fakes.log("codex"), ["plugin list --json"]);
    assert_eq!(fx.agent(&json, "claude")["status"], "updated");
}

#[test]
fn update_dry_run_changes_nothing() {
    let fx = fixture(&["codex", "claude"]);
    old_install(&fx);
    let (code, json) = fx.json(&[], &["update", "--dry-run"]);
    assert_eq!(code, 0, "{json}");
    let action = fx.agent(&json, "codex")["plugin"]["action"]
        .as_str()
        .unwrap();
    assert!(
        action.contains(&format!("update version 0.0.1 to {VERSION}")),
        "{action}"
    );
    for name in ["codex", "claude"] {
        assert_eq!(fx.fakes.log(name), ["plugin list --json"]);
        assert_eq!(fx.fakes.installed(name).as_deref(), Some("0.0.1"));
    }
    assert!(fx.fakes.trust_writes().is_empty());
}

#[test]
fn the_plan_and_the_report_name_the_hook_trust() {
    let fx = fixture(&["codex"]);
    let (code, out, err) = fx.run(&[], &["setup", "--agent", "codex", "--dry-run"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("Dry run"), "{out}");
    assert!(out.contains("install version"), "{out}");
    let (code, out, err) = fx.run(&[], &["setup", "--agent", "codex", "--yes"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("hooks: trusted 2"), "{out}");
    assert!(out.contains("rules/agboard.rules"), "{out}");
}

#[test]
fn setup_needs_no_project_and_writes_inside_the_given_homes_only() {
    let fx = fixture(&["codex", "claude"]);
    let elsewhere: &Path = fx.home.parent().unwrap();
    let codex_home = elsewhere.join("codex-home");
    let claude_dir = elsewhere.join("claude-config");
    fs::create_dir_all(&codex_home).unwrap();
    fs::write(
        codex_home.join("config.toml"),
        "sandbox_mode = \"workspace-write\"\n",
    )
    .unwrap();
    let (code, json) = fx.json(
        &[
            ("CODEX_HOME", codex_home.to_str().unwrap()),
            ("CLAUDE_CONFIG_DIR", claude_dir.to_str().unwrap()),
        ],
        &["setup", "--agent", "all", "--yes"],
    );
    assert_eq!(code, 0, "{json}");
    assert!(codex_home.join("rules/agboard.rules").is_file());
    assert!(claude_dir.join("settings.json").is_file());
    assert!(!fx.home.join(".claude").exists());
    assert!(!fx.home.join(".codex/rules").exists());
}
