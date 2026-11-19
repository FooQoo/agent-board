//! The launcher with fake `claude` and `codex` scripts in a temporary folder. The scripts answer
//! the login and model commands and otherwise record their arguments and environment, then sleep
//! until they are stopped. Every test uses its own temporary data area.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tempfile::TempDir;

use super::*;
use crate::server::sessions::{Attributes, Origin};

/// Tests that start children read the process environment, and one test sets variables in it.
static ENV: Mutex<()> = Mutex::new(());

const SCRIPT: &str = r#"#!/bin/sh
d=$(dirname "$0")
n=$(basename "$0")
case "$1" in
  auth) if [ -f "$d/logged-out" ]; then echo '{"loggedIn":false}'; else echo '{"loggedIn":true}'; fi; exit 0 ;;
  login) if [ -f "$d/logged-out" ]; then exit 1; fi; exit 0 ;;
  debug) cat "$d/models.json"; exit $?  ;;
esac
{ echo "ARGS: $*"; echo "PWD: $(pwd)"; env; } > "$d/$n.record.tmp"
mv "$d/$n.record.tmp" "$d/$n.record"
if [ -f "$d/exit-now" ]; then exit 0; fi
exec sleep 60
"#;

const MODELS: &str = r#"{"models":[
  {"slug":"gpt-a","display_name":"GPT A","visibility":"list"},
  {"slug":"gpt-hidden","display_name":"Hidden","visibility":"hide"}]}"#;

struct Fixture {
    dir: TempDir,
    folder: TempDir,
    registry: Arc<SessionRegistry>,
    launcher: Arc<Launcher>,
}

fn project() -> ProjectId {
    "0123456789abcdef0123456789abcdef".parse().unwrap()
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let bin = |name: &str| {
        let path = dir.path().join(name);
        std::fs::write(&path, SCRIPT).unwrap();
        std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        path
    };
    let claude = bin("claude");
    let codex = bin("codex");
    std::fs::write(dir.path().join("models.json"), MODELS).unwrap();
    let registry = SessionRegistry::new(Duration::from_secs(30));
    let data = dir.path().join("data");
    let launcher = Launcher::with_stop_grace(
        registry.clone(),
        Executables::fixed(Some(claude), Some(codex)),
        &data,
        Duration::from_secs(5),
    );
    Fixture {
        dir,
        folder,
        registry,
        launcher,
    }
}

impl Fixture {
    fn launch(&self, tool: Tool, model: Option<&str>) -> Result<Launched, AgboardError> {
        self.launcher
            .launch(&project(), "demo", self.folder.path(), tool, model)
    }

    /// The record the fake script wrote, once it has started.
    fn record(&self, name: &str) -> String {
        let path = self.dir.path().join(format!("{name}.record"));
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until {
            if let Ok(text) = std::fs::read_to_string(&path) {
                return text;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("{name} never started");
    }
}

fn alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn wait_until(what: &str, mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if ready() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timed out waiting for {what}");
}

#[test]
fn claude_starts_headless_with_every_permission_and_a_scrubbed_environment() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: every test of this module that starts a child holds `ENV`, and no other thread of
    // the test binary reads or writes these variables.
    unsafe {
        std::env::set_var("CLAUDECODE", "1");
        std::env::set_var("CLAUDE_CODE_X", "1");
        std::env::set_var("CODEX_X", "1");
        std::env::set_var("CODEX_HOME", "/kept");
        std::env::set_var("AGBOARD_RESIDENT_ID", "inherited");
    }
    let fx = fixture();
    let launched = fx.launch(Tool::ClaudeCode, Some("sonnet")).unwrap();
    let record = fx.record("claude");
    unsafe {
        for name in [
            "CLAUDECODE",
            "CLAUDE_CODE_X",
            "CODEX_X",
            "CODEX_HOME",
            "AGBOARD_RESIDENT_ID",
        ] {
            std::env::remove_var(name);
        }
    }
    assert!(
        record.contains("--permission-mode bypassPermissions"),
        "{record}"
    );
    assert!(record.contains("--model sonnet"), "{record}");
    assert!(record.contains("--output-format stream-json"), "{record}");
    assert!(
        record.contains("-p You were launched by Agent Board"),
        "{record}"
    );
    assert!(
        record.lines().all(|l| !l.starts_with("CLAUDECODE=")),
        "{record}"
    );
    assert!(
        record.lines().all(|l| !l.starts_with("CLAUDE_CODE_X=")),
        "{record}"
    );
    assert!(
        record.lines().all(|l| !l.starts_with("CODEX_X=")),
        "{record}"
    );
    assert!(record.lines().any(|l| l == "CODEX_HOME=/kept"), "{record}");
    assert!(
        record
            .lines()
            .any(|l| l == "AGBOARD_SESSION_TOOL=claude-code")
    );
    assert!(record.lines().any(|l| l == "AGBOARD_SESSION_ORIGIN=board"));
    let resident = record
        .lines()
        .find_map(|l| l.strip_prefix("AGBOARD_RESIDENT_ID="))
        .unwrap();
    assert!(resident.starts_with("resident-") && resident != "inherited");
    let folder = std::fs::canonicalize(fx.folder.path()).unwrap();
    let pwd = record
        .lines()
        .find_map(|l| l.strip_prefix("PWD: "))
        .unwrap();
    assert_eq!(std::fs::canonicalize(pwd).unwrap(), folder);
    assert!(fx.launcher.log_path(Tool::ClaudeCode).is_file());
    assert_eq!(fx.launcher.status().len(), 1);
    assert_eq!(fx.launcher.status()[0].pid, launched.pid);
    fx.launcher.shutdown();
}

#[test]
fn codex_starts_in_the_project_folder_without_a_model_flag_by_default() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    fx.launch(Tool::Codex, None).unwrap();
    let record = fx.record("codex");
    assert!(record.contains("ARGS: exec --json -C "), "{record}");
    assert!(record.contains("--dangerously-bypass-approvals-and-sandbox"));
    assert!(record.contains("--skip-git-repo-check"));
    assert!(!record.contains(" -m "), "{record}");
    fx.launcher.stop(Tool::Codex).unwrap();
    fx.launch(Tool::Codex, Some("gpt-a")).unwrap();
    wait_until("the second codex record", || {
        fx.record("codex").contains(" -m gpt-a ")
    });
    fx.launcher.shutdown();
}

#[test]
fn a_second_launch_of_a_tool_is_refused_with_a_reason_but_another_tool_is_not() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    fx.launch(Tool::ClaudeCode, None).unwrap();
    let refused = fx.launch(Tool::ClaudeCode, None).unwrap_err();
    assert_eq!(refused.code(), "session_launch_refused");
    assert!(refused.reason().contains("already running"));
    fx.launch(Tool::Codex, None).unwrap();
    fx.launcher.shutdown();
    assert!(fx.launcher.status().is_empty());
}

#[test]
fn a_board_session_the_registry_counts_refuses_a_launch() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let fx = fixture();
    let _hold = fx.registry.register(Attributes {
        project: project(),
        key: "resident:abc".into(),
        tool: Tool::Codex,
        origin: Origin::Board,
    });
    let refused = fx.launch(Tool::Codex, None).unwrap_err();
    assert_eq!(refused.code(), "session_launch_refused");
    // An external session of the same tool does not count.
    fx.registry.remove_board(Tool::Codex);
    let _external = fx.registry.register(Attributes {
        project: project(),
        key: "codex:def".into(),
        tool: Tool::Codex,
        origin: Origin::External,
    });
    fx.launch(Tool::Codex, None).unwrap();
    fx.launcher.shutdown();
}

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
