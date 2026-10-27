//! Focused tests for `agboard connect`: the interactive steps, the common
//! Skill and Hook scopes, the refusals, cancel, partial success, and reruns.
//! The prompts run on a pseudo-terminal; the results are checked on disk and
//! through the Hook. Every case has its own AGBOARD_HOME, CODEX_HOME,
//! CLAUDE_CONFIG_DIR, HOME, and a PATH that holds only fake agents; the real
//! home and agent settings are never read or written.

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use expectrl::process::unix::WaitStatus;
use expectrl::session::OsSession as Session;
use expectrl::{ControlCode, Eof, Expect};
use serde_json::Value;

const CODEX_CONFIG: &str = "sandbox_mode = \"workspace-write\"\n";

struct Fx {
    tmp: tempfile::TempDir,
}

impl Fx {
    /// A bound project "Demo" with fake `claude` and `codex` on PATH.
    fn new() -> Fx {
        let fx = Fx::unbound();
        fx.agboard(&["project", "create", "Demo"], &fx.root());
        fx
    }

    /// The same, but nothing is bound.
    fn unbound() -> Fx {
        let tmp = tempfile::tempdir().unwrap();
        let fx = Fx { tmp };
        for dir in ["home", "data", "codex", "claude", "project", "bin", "other"] {
            fs::create_dir_all(fx.base().join(dir)).unwrap();
        }
        fs::write(fx.base().join("codex/config.toml"), CODEX_CONFIG).unwrap();
        fx.fake_agent("claude", "2.0.1 (Claude Code)");
        fx.fake_agent("codex", "codex-cli 0.9.0");
        fx
    }

    fn base(&self) -> PathBuf {
        self.tmp.path().canonicalize().unwrap()
    }
    fn root(&self) -> PathBuf {
        self.base().join("project")
    }
    fn claude(&self) -> PathBuf {
        self.base().join("claude")
    }
    fn codex(&self) -> PathBuf {
        self.base().join("codex")
    }
    fn home(&self) -> PathBuf {
        self.base().join("home")
    }
    fn data(&self) -> PathBuf {
        self.base().join("data")
    }

    fn fake_agent(&self, name: &str, version: &str) {
        let path = self.base().join("bin").join(name);
        fs::write(&path, format!("#!/bin/sh\necho '{version}'\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn remove_agent(&self, name: &str) {
        fs::remove_file(self.base().join("bin").join(name)).unwrap();
    }

    fn command(&self, cwd: &Path) -> Command {
        let mut command = Command::new(assert_cmd::cargo::cargo_bin("agboard"));
        command
            .current_dir(cwd)
            .env_clear()
            .env("AGBOARD_HOME", self.data())
            .env("HOME", self.home())
            .env("CODEX_HOME", self.codex())
            .env("CLAUDE_CONFIG_DIR", self.claude())
            .env("PATH", self.base().join("bin"))
            .env("TZ", "UTC");
        command
    }

    /// Runs a non-interactive command and returns (exit code, stdout, stderr).
    fn agboard(&self, args: &[&str], cwd: &Path) -> (i32, String, String) {
        let output = self
            .command(cwd)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    fn session(&self, cwd: &Path, args: &[&str]) -> Session {
        let mut command = self.command(cwd);
        command.args(args);
        let mut session = expectrl::Session::spawn(command).unwrap();
        session.set_expect_timeout(Some(Duration::from_secs(20)));
        session
    }

    /// A session for a run that prints and exits without asking anything.
    /// macOS can drop what a pseudo-terminal holds once its last writer has
    /// exited, so a shell keeps the terminal open for a moment after agboard
    /// ends and then exits with agboard's own code.
    fn short_session(&self, cwd: &Path, args: &[&str]) -> Session {
        let agboard = self.command(cwd);
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("\"$0\" \"$@\"; status=$?; /bin/sleep 1; exit $status")
            .arg(agboard.get_program())
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(agboard.get_envs().filter_map(|(k, v)| v.map(|v| (k, v))));
        let mut session = expectrl::Session::spawn(command).unwrap();
        session.set_expect_timeout(Some(Duration::from_secs(20)));
        session
    }

    /// Runs connect on a terminal with `answers`, one line each, waiting for
    /// the prompt text in `prompts` before every answer. Returns the exit
    /// code and everything printed.
    fn connect(&self, cwd: &Path, steps: &[(&str, &str)]) -> (i32, String) {
        let mut term = self.session(cwd, &["connect"]);
        let mut screen = String::new();
        for (prompt, answer) in steps {
            let seen = term.expect(*prompt).unwrap_or_else(|e| {
                panic!("prompt {prompt:?} not shown ({e}); screen so far:\n{screen}")
            });
            screen.push_str(&String::from_utf8_lossy(seen.as_bytes()));
            term.send_line(*answer).unwrap();
        }
        let (code, rest) = finish(term);
        screen.push_str(&rest);
        (code, screen)
    }

    /// Both agents, one scope pair, and a yes.
    fn connect_both(&self, skill: &str, hook: &str) -> (i32, String) {
        self.connect(
            &self.root(),
            &[
                ("Select agents", "1 2"),
                ("Skill scope", skill),
                ("Hook scope", hook),
                ("[y/N]", "y"),
            ],
        )
    }

    fn registry(&self) -> Value {
        serde_json::from_str(&fs::read_to_string(self.data().join("integrations.json")).unwrap())
            .unwrap()
    }
}

fn finish(mut term: Session) -> (i32, String) {
    let rest = term.expect(Eof).unwrap();
    let text = String::from_utf8_lossy(rest.as_bytes()).into_owned();
    match term.get_process().wait().unwrap() {
        WaitStatus::Exited(_, code) => (code, text),
        other => panic!("unexpected end: {other:?}\n{text}"),
    }
}

/// Every file below `dir` with its bytes (the fake agents included).
fn world(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else {
                out.insert(path.clone(), fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, &mut out);
    out
}

fn hook_count(path: &Path) -> usize {
    fs::read_to_string(path)
        .map(|t| t.matches("agboard hook").count())
        .unwrap_or(0)
}

fn registered(fx: &Fx, agent: &str, component: &str) -> Value {
    fx.registry()["installations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["agent"] == agent && r["component"] == component)
        .unwrap_or_else(|| panic!("no {agent} {component} record"))
        .clone()
}

#[test]
fn refuses_a_pipe_without_waiting_and_writes_nothing() {
    let fx = Fx::new();
    let before = world(&fx.base());
    let mut child = fx
        .command(&fx.root())
        .arg("connect")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Input is available, and still the command must not use it.
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"1\n1\n1\ny\n")
        .ok();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("terminal"), "{stderr}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn refuses_yes_dry_run_json_and_a_project_name() {
    let fx = Fx::new();
    let before = world(&fx.base());
    for args in [
        vec!["connect", "--yes"],
        vec!["connect", "--dry-run"],
        vec!["connect", "--json"],
        vec!["--json", "connect"],
        vec!["--project", "Demo", "connect"],
    ] {
        let (code, stdout, stderr) = fx.agboard(&args, &fx.root());
        assert_eq!(code, 2, "{args:?}: {stdout}{stderr}");
    }
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn an_unbound_folder_gets_the_create_and_bind_examples_and_nothing_else() {
    let fx = Fx::unbound();
    let before = world(&fx.base());
    let other = fx.base().join("other");
    let term = fx.short_session(&other, &["connect"]);
    let (code, screen) = finish(term);
    assert!(screen.contains("not bound"), "{screen}");
    assert!(screen.contains("agboard project create"), "{screen}");
    assert!(screen.contains("agboard project bind"), "{screen}");
    assert_eq!(code, 1, "{screen}");
    assert!(!screen.contains("Select agents"), "{screen}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn the_header_names_the_project_and_the_bound_root_from_a_subdirectory() {
    let fx = Fx::new();
    let sub = fx.root().join("src/deep");
    fs::create_dir_all(&sub).unwrap();
    let (code, screen) = fx.connect(
        &sub,
        &[
            ("Select agents", "q"), // cancel at the first question
        ],
    );
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("Demo"), "{screen}");
    assert!(screen.contains(fx.root().to_str().unwrap()), "{screen}");
}

#[test]
fn skill_global_with_hook_project_places_both_agents_independently() {
    let fx = Fx::new();
    let (code, screen) = fx.connect_both("1", "2");
    assert_eq!(code, 0, "{screen}");
    // Skills in the user's configuration, Hooks in the bound project.
    assert!(fx.claude().join("skills/agent-board/SKILL.md").is_file());
    assert!(
        fx.home()
            .join(".agents/skills/agent-board/SKILL.md")
            .is_file()
    );
    assert!(hook_count(&fx.root().join(".claude/settings.json")) > 0);
    assert!(hook_count(&fx.root().join(".codex/hooks.json")) > 0);
    assert_eq!(hook_count(&fx.claude().join("settings.json")), 0);
    assert_eq!(hook_count(&fx.codex().join("hooks.json")), 0);
    assert!(!fx.root().join(".claude/skills").exists());
    // The result names each agent, the restart, and the trust step.
    assert!(screen.contains("Claude Code: configured."), "{screen}");
    assert!(screen.contains("Codex: configured."), "{screen}");
    assert!(screen.contains("/hooks"), "{screen}");
    assert!(
        screen.contains("restart") || screen.contains("new session"),
        "{screen}"
    );
    // The registry records the chosen scopes.
    assert_eq!(registered(&fx, "claude", "skill")["scope"], "global");
    assert_eq!(registered(&fx, "claude", "hook")["scope"], "project");
    assert_eq!(registered(&fx, "codex", "skill")["scope"], "global");
    assert_eq!(registered(&fx, "codex", "hook")["scope"], "project");
}

#[test]
fn skill_project_with_hook_global_is_the_other_combination() {
    let fx = Fx::new();
    let (code, screen) = fx.connect_both("2", "1");
    assert_eq!(code, 0, "{screen}");
    assert!(
        fx.root()
            .join(".claude/skills/agent-board/SKILL.md")
            .is_file()
    );
    assert!(
        fx.root()
            .join(".agents/skills/agent-board/SKILL.md")
            .is_file()
    );
    assert!(hook_count(&fx.claude().join("settings.json")) > 0);
    assert!(hook_count(&fx.codex().join("hooks.json")) > 0);
    assert_eq!(hook_count(&fx.root().join(".claude/settings.json")), 0);
    assert_eq!(registered(&fx, "claude", "skill")["scope"], "project");
    assert_eq!(registered(&fx, "codex", "hook")["scope"], "global");
}

#[test]
fn the_installed_hook_command_reports_the_bound_project() {
    let fx = Fx::new();
    let (code, screen) = fx.connect_both("1", "1");
    assert_eq!(code, 0, "{screen}");
    let settings: Value =
        serde_json::from_str(&fs::read_to_string(fx.claude().join("settings.json")).unwrap())
            .unwrap();
    assert!(settings.to_string().contains("agboard hook --agent claude"));
    let mut child = fx
        .command(&fx.root())
        .args(["hook", "--agent", "claude"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let input = format!(
        "{{\"hook_event_name\":\"SessionStart\",\"cwd\":{:?}}}",
        fx.root().to_str().unwrap()
    );
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("Demo"), "{text:?} {:?}", output.stderr);
}

#[test]
fn the_confirmation_lists_placement_changes_permissions_and_the_backup_policy() {
    let fx = Fx::new();
    fs::write(fx.claude().join("settings.json"), "{\"theme\":\"dark\"}\n").unwrap();
    let mut term = fx.session(&fx.root(), &["connect"]);
    let mut screen = String::new();
    for (prompt, answer) in [
        ("Select agents", "1 2"),
        ("Skill scope", "1"),
        ("Hook scope", "2"),
        ("[y/N]", "n"),
    ] {
        let seen = term.expect(prompt).unwrap();
        screen.push_str(&String::from_utf8_lossy(seen.as_bytes()));
        term.send_line(answer).unwrap();
    }
    let (code, rest) = finish(term);
    screen.push_str(&rest);
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("skills/agent-board"), "{screen}");
    assert!(screen.contains(".codex/hooks.json"), "{screen}");
    assert!(screen.contains("additionalDirectories"), "{screen}");
    assert!(screen.contains("writable_roots"), "{screen}");
    assert!(screen.to_lowercase().contains("backup"), "{screen}");
}

#[test]
fn a_no_cancels_without_writing_and_so_do_eof_and_ctrl_c() {
    let fx = Fx::new();
    let before = world(&fx.base());
    // N
    let (code, screen) = fx.connect(
        &fx.root(),
        &[
            ("Select agents", "1 2"),
            ("Skill scope", "1"),
            ("Hook scope", "1"),
            ("[y/N]", "n"),
        ],
    );
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("Cancelled"), "{screen}");
    assert_eq!(world(&fx.base()), before);
    // The empty answer is the default N.
    let (code, _) = fx.connect(
        &fx.root(),
        &[
            ("Select agents", "1 2"),
            ("Skill scope", "1"),
            ("Hook scope", "1"),
            ("[y/N]", ""),
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(world(&fx.base()), before);
    // End of input at the confirmation.
    let mut term = fx.session(&fx.root(), &["connect"]);
    for prompt in ["Select agents", "Skill scope", "Hook scope"] {
        term.expect(prompt).unwrap();
        term.send_line(if prompt == "Select agents" {
            "1 2"
        } else {
            "1"
        })
        .unwrap();
    }
    term.expect("[y/N]").unwrap();
    term.send(ControlCode::EndOfTransmission).unwrap();
    let (code, _) = finish(term);
    assert_eq!(code, 0);
    assert_eq!(world(&fx.base()), before);
    // Ctrl-C at the scope question.
    let mut term = fx.session(&fx.root(), &["connect"]);
    term.expect("Select agents").unwrap();
    term.send_line("1 2").unwrap();
    term.expect("Skill scope").unwrap();
    term.send(ControlCode::EndOfText).unwrap();
    let _ = term.expect(Eof);
    let status = term.get_process().wait().unwrap();
    assert!(!matches!(status, WaitStatus::Exited(_, 0)), "{status:?}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn an_agent_that_is_not_on_path_cannot_be_selected() {
    let fx = Fx::new();
    fx.remove_agent("codex");
    let before = world(&fx.base());
    let mut term = fx.session(&fx.root(), &["connect"]);
    let seen = term.expect("Select agents").unwrap();
    let screen = String::from_utf8_lossy(seen.as_bytes()).into_owned();
    assert!(screen.contains("2.0.1"), "{screen}");
    assert!(screen.contains("Codex"), "{screen}");
    assert!(screen.contains("not found on PATH"), "{screen}");
    // Choosing the undetected agent is refused, and the question comes back.
    term.send_line("2").unwrap();
    term.expect("not available").unwrap();
    term.expect("Select agents").unwrap();
    term.send_line("q").unwrap();
    let (code, _) = finish(term);
    assert_eq!(code, 0);
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn only_the_detected_agent_is_configured() {
    let fx = Fx::new();
    fx.remove_agent("codex");
    let (code, screen) = fx.connect(
        &fx.root(),
        &[
            ("Select agents", "1"),
            ("Skill scope", "1"),
            ("Hook scope", "1"),
            ("[y/N]", "y"),
        ],
    );
    assert_eq!(code, 0, "{screen}");
    assert!(fx.claude().join("skills/agent-board/SKILL.md").is_file());
    assert!(!fx.codex().join("hooks.json").exists());
    assert!(!fx.home().join(".agents").exists());
}

#[test]
fn no_detected_agent_ends_without_a_change() {
    let fx = Fx::new();
    fx.remove_agent("codex");
    fx.remove_agent("claude");
    let before = world(&fx.base());
    let term = fx.short_session(&fx.root(), &["connect"]);
    let (code, screen) = finish(term);
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("No supported agent"), "{screen}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn a_rerun_proposes_the_recorded_choices_and_changes_nothing() {
    let fx = Fx::new();
    let (code, screen) = fx.connect_both("1", "2");
    assert_eq!(code, 0, "{screen}");
    let before = world(&fx.base());
    // Enter at every question takes the recorded agents and scopes.
    let (code, screen) = fx.connect(
        &fx.root(),
        &[
            ("Select agents", ""),
            ("Skill scope", ""),
            ("Hook scope", ""),
        ],
    );
    // Nothing differs, so there is no question to answer.
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("No changes"), "{screen}");
    assert!(!screen.contains("[y/N]"), "{screen}");
    assert_eq!(world(&fx.base()), before);
    assert!(hook_count(&fx.root().join(".claude/settings.json")) > 0);
}

#[test]
fn changing_a_scope_moves_the_hook_without_leaving_a_second_registration() {
    let fx = Fx::new();
    let (code, screen) = fx.connect_both("1", "2");
    assert_eq!(code, 0, "{screen}");
    let project_hooks = hook_count(&fx.root().join(".claude/settings.json"));
    assert!(project_hooks > 0);
    let (code, screen) = fx.connect_both("1", "1");
    assert_eq!(code, 0, "{screen}");
    assert!(screen.to_lowercase().contains("remove"), "{screen}");
    assert_eq!(hook_count(&fx.root().join(".claude/settings.json")), 0);
    assert_eq!(
        hook_count(&fx.claude().join("settings.json")),
        project_hooks
    );
    assert_eq!(registered(&fx, "claude", "hook")["scope"], "global");
}

#[test]
fn one_agent_failing_restores_only_that_agent() {
    let fx = Fx::new();
    // Codex cannot write beside its settings: the apply of that agent fails.
    let codex_before = world(&fx.codex());
    fs::set_permissions(fx.codex(), fs::Permissions::from_mode(0o555)).unwrap();
    let (code, screen) = fx.connect_both("1", "1");
    fs::set_permissions(fx.codex(), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(code, 1, "{screen}");
    assert!(screen.contains("Claude Code: configured."), "{screen}");
    assert!(screen.contains("Codex: not configured"), "{screen}");
    assert!(screen.contains("Setup finished with errors."), "{screen}");
    // Claude Code stays configured; Codex is as it was.
    assert!(fx.claude().join("skills/agent-board/SKILL.md").is_file());
    assert!(hook_count(&fx.claude().join("settings.json")) > 0);
    assert_eq!(world(&fx.codex()), codex_before);
    assert!(!fx.home().join(".agents/skills/agent-board").exists());
    let registry = fx.registry();
    let agents: Vec<&str> = registry["installations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["agent"].as_str().unwrap())
        .collect();
    assert!(
        agents.contains(&"claude") && !agents.contains(&"codex"),
        "{agents:?}"
    );
    // Once the cause is gone, a rerun completes Codex and leaves Claude alone.
    let claude_before = world(&fx.claude());
    let (code, screen) = fx.connect_both("1", "1");
    assert_eq!(code, 0, "{screen}");
    assert_eq!(world(&fx.claude()), claude_before);
    assert!(hook_count(&fx.codex().join("hooks.json")) > 0);
}

#[test]
fn an_unfinished_earlier_run_is_recovered_and_reported_before_planning() {
    use agent_board::integrations::apply::{ApplyOptions, Phase, StepAction, apply_agent};
    use agent_board::integrations::assets::bundle;
    use agent_board::integrations::paths::{PathEnv, registry_path, resolve_targets};
    use agent_board::integrations::plan::{PlanInput, plan_agent};
    use agent_board::integrations::registry::Registry;
    use agent_board::integrations::{Agent, Scope};

    let fx = Fx::new();
    let env = PathEnv {
        agboard_home: Some(fx.data().into()),
        home: Some(fx.home()),
        codex_home: Some(fx.codex().into()),
        claude_config_dir: Some(fx.claude().into()),
    };
    let targets = resolve_targets(
        &env,
        Agent::Claude,
        Scope::Global,
        Scope::Global,
        Some(&fx.root()),
    )
    .unwrap();
    let registry = Registry::read(&registry_path(&env).unwrap())
        .unwrap()
        .unwrap_or_default();
    let bundle = bundle().unwrap();
    let plan = plan_agent(&PlanInput {
        env: &env,
        targets: &targets,
        project_id: Some("x"),
        scan_root: Some(&fx.root()),
        registry: &registry,
        bundle: &bundle,
        permissions: true,
    })
    .unwrap();
    let crash = |step: &agent_board::integrations::apply::Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    apply_agent(
        &env,
        &plan,
        &ApplyOptions {
            observer: Some(&crash),
        },
    );
    assert!(fx.data().join("integrations.json").exists() || fx.claude().join("skills").exists());

    let (code, screen) = fx.connect(
        &fx.root(),
        &[
            ("Select agents", "1"),
            ("Skill scope", "1"),
            ("Hook scope", "1"),
            ("[y/N]", "y"),
        ],
    );
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("unfinished"), "{screen}");
    assert!(fx.claude().join("skills/agent-board/SKILL.md").is_file());
    assert_eq!(registered(&fx, "claude", "skill")["scope"], "global");
}

const PREVIEW: &str =
    "Public preview: this command may change. See the documentation for current limitations.";

#[test]
fn the_interactive_screen_starts_with_the_preview_line() {
    let fx = Fx::new();
    let (code, screen) = fx.connect(&fx.root(), &[("Select agents", "q")]);
    assert_eq!(code, 0, "{screen}");
    assert!(screen.trim_start().starts_with(PREVIEW), "{screen}");
    assert!(screen.find(PREVIEW) < screen.find("Project:"), "{screen}");
}

#[test]
fn refusals_and_usage_errors_do_not_print_the_preview_line() {
    let fx = Fx::new();
    let (code, stdout, stderr) = fx.agboard(&["connect", "--json"], &fx.root());
    assert_eq!(code, 2);
    assert!(!format!("{stdout}{stderr}").contains(PREVIEW));
    let output = fx
        .command(&fx.root())
        .arg("connect")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!text.contains(PREVIEW), "{text}");
    let unbound = Fx::unbound();
    let (code, screen) = finish(unbound.session(&unbound.base().join("other"), &["connect"]));
    assert_eq!(code, 1, "{screen}");
    assert!(!screen.contains(PREVIEW), "{screen}");
}
