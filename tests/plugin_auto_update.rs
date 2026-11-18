//! The automatic plugin update of the SessionStart hook: the hook compares the
//! files of the plugin the agent runs with the ones this agboard ships and,
//! when they differ, reinstalls the plugin in a detached process. The agents
//! are the fakes of `support/fake_agents.rs`, the only commands on PATH, and
//! the marketplace override keeps the install off the network.

#[path = "support/fake_agents.rs"]
mod fake_agents;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use fake_agents::FakeAgents;

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct Fixture {
    _tmp: tempfile::TempDir,
    data: PathBuf,
    home: PathBuf,
    marketplace: PathBuf,
    fakes: FakeAgents,
    /// The folder of the plugin the agent runs.
    plugin_root: PathBuf,
    /// Whether the hook points the update at a local marketplace (no tag, so
    /// no tag check) instead of the release tag on GitHub.
    use_override: bool,
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// `agent` has the plugin installed at an old version; its plugin root is a
/// copy of the shipped plugin, with `edited` appended to its README when the
/// installed plugin is to differ.
fn fixture(agent: &str, edited: bool) -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    let data = tmp.path().join("data");
    fs::create_dir_all(&home).unwrap();
    let marketplace = tmp.path().join("marketplace");
    fs::create_dir_all(&marketplace).unwrap();
    let fakes = FakeAgents::new(tmp.path(), &[agent]);
    fakes.preinstall(agent, "0.0.1", "elsewhere");
    let plugin_root = tmp
        .path()
        .join("home/.agent/plugins/cache/agent-board/agent-board/0.0.1");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("plugins/agent-board"),
        &plugin_root,
    );
    if edited {
        let readme = plugin_root.join("README.md");
        let text = fs::read_to_string(&readme).unwrap();
        fs::write(readme, format!("{text}\nedited\n")).unwrap();
    }
    Fixture {
        _tmp: tmp,
        data,
        home,
        marketplace,
        fakes,
        plugin_root,
        use_override: true,
    }
}

impl Fixture {
    /// Runs the hook for `agent` at `event` and returns its parsed output
    /// (`Null` when it printed nothing).
    fn hook(&self, agent: &str, event: &str, env: &[(&str, &str)]) -> Value {
        let root_var = if agent == "codex" {
            "PLUGIN_ROOT"
        } else {
            "CLAUDE_PLUGIN_ROOT"
        };
        let mut command = Command::new(env!("CARGO_BIN_EXE_agboard"));
        command.env_clear();
        if self.use_override {
            command.env("AGBOARD_PLUGIN_MARKETPLACE", &self.marketplace);
        }
        let mut child = command
            .env("HOME", &self.home)
            .env("PATH", &self.fakes.bin)
            .env("TZ", "UTC")
            .env("AGBOARD_HOME", &self.data)
            .env("AGBOARD_AUTOSTART", "0")
            .env("AGBOARD_OPEN_BROWSER", "0")
            .env(root_var, &self.plugin_root)
            .envs(env.iter().copied())
            .current_dir(&self.home)
            .args(["hook", "--agent", agent])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        let input = serde_json::json!({"hook_event_name": event, "cwd": self.home}).to_string();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(output.stderr, b"");
        serde_json::from_slice(&output.stdout).unwrap_or(Value::Null)
    }

    fn notice(output: &Value) -> Option<String> {
        output["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .filter(|text| text.contains("AGBOARD_NOTICE"))
            .map(str::to_string)
    }

    fn state_file(&self, agent: &str) -> PathBuf {
        self.data.join(format!("plugin-update/{agent}.json"))
    }

    fn lock_file(&self, agent: &str) -> PathBuf {
        self.data.join(format!("plugin-update/{agent}.lock"))
    }

    /// Waits for the detached update of `agent` to finish: its state file says
    /// it did and the lock is gone.
    fn wait_finished(&self, agent: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Ok(text) = fs::read_to_string(self.state_file(agent))
                && !self.lock_file(agent).exists()
                && let Ok(value) = serde_json::from_str::<Value>(&text)
                && value["ok"] == true
            {
                return value;
            }
            assert!(
                Instant::now() < deadline,
                "the update did not finish: {:?}",
                self.fakes.log(agent)
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Gives a detached process that should not start time to show itself.
    fn settle() {
        std::thread::sleep(Duration::from_millis(700));
    }
}

#[test]
fn a_plugin_that_matches_is_left_alone() {
    let fx = fixture("claude", false);
    let out = fx.hook("claude", "SessionStart", &[]);
    assert_eq!(Fixture::notice(&out), None);
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());
    assert!(!fx.data.join("plugin-update").exists());
}

#[test]
fn a_plugin_that_differs_is_reinstalled_in_the_background_from_the_next_session() {
    let fx = fixture("claude", true);
    let out = fx.hook("claude", "SessionStart", &[]);
    let notice = Fixture::notice(&out).expect("a notice at session start");
    assert!(notice.contains(&format!("version {VERSION}")), "{notice}");
    assert!(notice.contains("next session"), "{notice}");
    assert!(!notice.contains("agboard update"), "{notice}");
    let state = fx.wait_finished("claude");
    assert_eq!(state["hash"], agent_board::setup::auto_update::PLUGIN_HASH);
    let log = fx.fakes.log("claude");
    assert!(
        log.iter().any(|l| l.starts_with("plugin install")),
        "{log:?}"
    );
    assert_eq!(fx.fakes.installed("claude").as_deref(), Some(VERSION));
}

#[test]
fn codex_is_told_to_trust_hooks_only_when_the_hook_definition_changed() {
    // Same hook definition, other files: nothing to trust, and no trust is given.
    let fx = fixture("codex", true);
    let out = fx.hook("codex", "SessionStart", &[]);
    let notice = Fixture::notice(&out).expect("a notice at session start");
    assert!(notice.contains("next session"), "{notice}");
    assert!(!notice.contains("agboard update"), "{notice}");
    fx.wait_finished("codex");
    let log = fx.fakes.log("codex");
    assert!(log.iter().any(|l| l.starts_with("plugin add")), "{log:?}");
    // The install folder is unknown to the fake listing: no trust.
    assert!(!log.contains(&"app-server".to_string()), "{log:?}");
    assert!(fx.fakes.trust_writes().is_empty());

    // An older hook definition (with --plugin-version): trust is needed again.
    let fx = fixture("codex", false);
    let hooks = fx.plugin_root.join("hooks/codex.json");
    let old = fs::read_to_string(&hooks)
        .unwrap()
        .replace("--agent codex", "--agent codex --plugin-version 0.0.1");
    fs::write(&hooks, old).unwrap();
    let out = fx.hook("codex", "SessionStart", &[]);
    let notice = Fixture::notice(&out).expect("a notice at session start");
    assert!(notice.contains("`agboard update`"), "{notice}");
    fx.wait_finished("codex");
    assert!(fx.fakes.trust_writes().is_empty());
}

#[test]
fn a_plugin_that_was_not_installed_from_a_marketplace_is_left_alone() {
    let fx = fixture("claude", true);
    let checkout = fx._tmp.path().join("checkout/plugins/agent-board");
    copy_dir(&fx.plugin_root, &checkout);
    let mut fx = fx;
    fx.plugin_root = checkout;
    let out = fx.hook("claude", "SessionStart", &[]);
    assert_eq!(Fixture::notice(&out), None);
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());
}

#[test]
fn codex_falls_back_to_the_claude_plugin_root_variable() {
    let fx = fixture("codex", true);
    let root = fx.plugin_root.to_str().unwrap().to_string();
    // PLUGIN_ROOT is unset in this run; only CLAUDE_PLUGIN_ROOT names it.
    let mut child = Command::new(env!("CARGO_BIN_EXE_agboard"))
        .env_clear()
        .env("HOME", &fx.home)
        .env("PATH", &fx.fakes.bin)
        .env("AGBOARD_HOME", &fx.data)
        .env("AGBOARD_AUTOSTART", "0")
        .env("AGBOARD_PLUGIN_MARKETPLACE", &fx.marketplace)
        .env("CLAUDE_PLUGIN_ROOT", root)
        .args(["hook", "--agent", "codex"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"SessionStart"}"#)
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(String::from_utf8_lossy(&output.stdout).contains("AGBOARD_NOTICE"));
    fx.wait_finished("codex");
}

#[test]
fn only_session_start_updates_and_the_opt_out_stops_it() {
    let fx = fixture("claude", true);
    let after_tool = fx.hook("claude", "PostToolUse", &[]);
    assert_eq!(Fixture::notice(&after_tool), None);
    let opted_out = fx.hook(
        "claude",
        "SessionStart",
        &[("AGBOARD_NO_PLUGIN_AUTO_UPDATE", "1")],
    );
    assert_eq!(Fixture::notice(&opted_out), None);
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());
    assert!(!fx.data.join("plugin-update").exists());
}

#[test]
fn a_session_without_a_plugin_root_does_nothing() {
    let fx = fixture("claude", true);
    let out = fx.hook("claude", "SessionStart", &[("CLAUDE_PLUGIN_ROOT", "")]);
    assert_eq!(Fixture::notice(&out), None);
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());
}

#[test]
fn a_live_lock_holds_other_sessions_back_and_a_stale_one_is_replaced() {
    let fx = fixture("claude", true);
    fs::create_dir_all(fx.data.join("plugin-update")).unwrap();
    fs::write(fx.lock_file("claude"), "999999").unwrap();
    let out = fx.hook("claude", "SessionStart", &[]);
    assert_eq!(Fixture::notice(&out), None);
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());

    let old = std::time::SystemTime::now() - Duration::from_secs(3600);
    fs::File::options()
        .write(true)
        .open(fx.lock_file("claude"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    let out = fx.hook("claude", "SessionStart", &[]);
    assert!(Fixture::notice(&out).is_some());
    fx.wait_finished("claude");
}

#[test]
fn a_recent_failure_is_not_retried_and_points_at_agboard_update() {
    let fx = fixture("claude", true);
    fs::create_dir_all(fx.data.join("plugin-update")).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    fs::write(
        fx.state_file("claude"),
        serde_json::json!({
            "hash": agent_board::setup::auto_update::PLUGIN_HASH,
            "ok": false,
            "at": now,
        })
        .to_string(),
    )
    .unwrap();
    let out = fx.hook("claude", "SessionStart", &[]);
    let notice = Fixture::notice(&out).expect("a notice about the failure");
    assert!(notice.contains("`agboard update`"), "{notice}");
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());

    // The same failure, long ago: tried again.
    fs::write(
        fx.state_file("claude"),
        serde_json::json!({
            "hash": agent_board::setup::auto_update::PLUGIN_HASH,
            "ok": false,
            "at": now - 7 * 3600,
        })
        .to_string(),
    )
    .unwrap();
    let out = fx.hook("claude", "SessionStart", &[]);
    assert!(Fixture::notice(&out).unwrap().contains("updating it"));
    fx.wait_finished("claude");
}

#[test]
fn a_failing_reinstall_is_recorded_and_not_repeated_at_once() {
    let fx = fixture("claude", true);
    fx.fakes.fail("claude", "plugin install");
    let out = fx.hook("claude", "SessionStart", &[]);
    assert!(Fixture::notice(&out).is_some());
    let deadline = Instant::now() + Duration::from_secs(30);
    while fx.lock_file("claude").exists() || !fx.state_file("claude").exists() {
        assert!(Instant::now() < deadline, "the update never ended");
        std::thread::sleep(Duration::from_millis(50));
    }
    let state: Value =
        serde_json::from_str(&fs::read_to_string(fx.state_file("claude")).unwrap()).unwrap();
    assert_eq!(state["ok"], false);
    let runs = fx.fakes.log("claude").len();
    let next = fx.hook("claude", "SessionStart", &[]);
    assert!(Fixture::notice(&next).unwrap().contains("did not complete"));
    Fixture::settle();
    assert_eq!(fx.fakes.log("claude").len(), runs);
}

/// A fake `git` that logs its arguments and exits with the code in
/// `git.exit` (default 2, "no such tag").
fn fake_git(fx: &Fixture, exit_code: i32) {
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{state}/git.log'\nexit {exit_code}\n",
        state = fx.fakes.state.display()
    );
    let path = fx.fakes.bin.join("git");
    fs::write(&path, script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn git_log(fx: &Fixture) -> Vec<String> {
    fs::read_to_string(fx.fakes.state.join("git.log"))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn the_tag_is_checked_before_any_agent_command_and_a_missing_tag_stops_the_update() {
    for exit_code in [2, 128] {
        // 2: the tag is absent. 128: the remote could not be reached.
        let mut fx = fixture("claude", true);
        fx.use_override = false;
        fake_git(&fx, exit_code);
        fx.hook("claude", "SessionStart", &[]);
        let deadline = Instant::now() + Duration::from_secs(30);
        while fx.lock_file("claude").exists() || !fx.state_file("claude").exists() {
            assert!(Instant::now() < deadline, "the update never ended");
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(
            git_log(&fx),
            [format!(
                "ls-remote --exit-code --tags https://github.com/FooQoo/agent-board.git refs/tags/v{VERSION}"
            )]
        );
        // Not even `plugin list` ran, and nothing was removed.
        assert_eq!(fx.fakes.log("claude"), Vec::<String>::new());
        let state: Value =
            serde_json::from_str(&fs::read_to_string(fx.state_file("claude")).unwrap()).unwrap();
        assert_eq!(state["ok"], false);
    }
}

#[test]
fn a_confirmed_tag_lets_the_update_run() {
    let mut fx = fixture("claude", true);
    fx.use_override = false;
    fake_git(&fx, 0);
    fx.hook("claude", "SessionStart", &[]);
    fx.wait_finished("claude");
    assert_eq!(git_log(&fx).len(), 1);
    assert!(
        fx.fakes
            .log("claude")
            .iter()
            .any(|l| l.starts_with("plugin install"))
    );
}

#[test]
fn codex_hooks_are_trusted_only_when_the_installed_definition_is_identical() {
    // Identical definition in the installed folder: trusted after the reinstall.
    let fx = fixture("codex", true);
    fx.fakes.install_path("codex", &fx.plugin_root);
    fx.hook("codex", "SessionStart", &[]);
    fx.wait_finished("codex");
    assert!(
        !fx.fakes.trust_writes().is_empty(),
        "{:?}",
        fx.fakes.log("codex")
    );

    // A different definition: never trusted.
    let fx = fixture("codex", false);
    let hooks = fx.plugin_root.join("hooks/codex.json");
    let old = fs::read_to_string(&hooks)
        .unwrap()
        .replace("--agent codex", "--agent codex --plugin-version 0.0.1");
    fs::write(&hooks, old).unwrap();
    fx.fakes.install_path("codex", &fx.plugin_root);
    fx.hook("codex", "SessionStart", &[]);
    fx.wait_finished("codex");
    assert!(fx.fakes.trust_writes().is_empty());
    assert!(!fx.fakes.log("codex").contains(&"app-server".to_string()));
}
