//! Shared setup of the update and notice tests: a bound project with fake
//! agents on PATH, every location inside one temporary directory, and helpers
//! that age an installation so that update has something to do. The real home
//! and agent settings are never read or written.

#![allow(dead_code)]
#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use agent_board::integrations::apply::{ApplyOptions, Status, Step, StepAction, apply_agent};
use agent_board::integrations::assets::{
    canonical_json, hook_manifest_hash, sha256_hex, skill_manifest_hash,
};
use agent_board::integrations::paths::{PathEnv, resolve_targets};
use agent_board::integrations::plan::{PlanInput, plan_agent};
use agent_board::integrations::registry::{InstallationRecord, Registry};
use agent_board::integrations::{Agent, Component, Scope};
use expectrl::process::unix::WaitStatus;
use expectrl::session::OsSession as Session;
use expectrl::{Eof, Expect};

#[path = "../support/prompt_keys.rs"]
pub mod prompt_keys;
pub use prompt_keys::{CONFIRM, answer};

/// A child process keeps copies of the descriptors that exist while it is
/// being spawned until it execs, and a copy of a lock file keeps the lock.
/// Spawning takes this lock shared; holding an agent lock in the test process
/// takes it exclusive, so the two never overlap.
static SPAWN: std::sync::RwLock<()> = std::sync::RwLock::new(());

/// An agent lock held by the test process, with spawning paused.
pub struct HeldLock {
    _lock: agent_board::integrations::journal::AgentLock,
    _spawn: std::sync::RwLockWriteGuard<'static, ()>,
}

pub struct Fx {
    pub tmp: tempfile::TempDir,
}

impl Fx {
    /// A bound project "Demo" at `project/` with fake `claude` and `codex`.
    pub fn new() -> Fx {
        let fx = Fx::unbound();
        fx.agboard(&["project", "create", "Demo"], &fx.root());
        fx
    }

    pub fn unbound() -> Fx {
        let fx = Fx {
            tmp: tempfile::tempdir().unwrap(),
        };
        for dir in ["home", "data", "codex", "claude", "project", "bin", "other"] {
            fs::create_dir_all(fx.base().join(dir)).unwrap();
        }
        fs::write(
            fx.base().join("codex/config.toml"),
            "sandbox_mode = \"workspace-write\"\n",
        )
        .unwrap();
        for (name, version) in [
            ("claude", "2.0.1 (Claude Code)"),
            ("codex", "codex-cli 0.9.0"),
        ] {
            let path = fx.base().join("bin").join(name);
            fs::write(&path, format!("#!/bin/sh\necho '{version}'\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fx
    }

    pub fn base(&self) -> PathBuf {
        self.tmp.path().canonicalize().unwrap()
    }
    pub fn root(&self) -> PathBuf {
        self.base().join("project")
    }
    pub fn other(&self) -> PathBuf {
        self.base().join("other")
    }
    pub fn claude(&self) -> PathBuf {
        self.base().join("claude")
    }
    pub fn data(&self) -> PathBuf {
        self.base().join("data")
    }
    pub fn registry_file(&self) -> PathBuf {
        self.data().join("integrations.json")
    }

    pub fn command(&self, cwd: &Path) -> Command {
        let mut command = Command::new(assert_cmd::cargo::cargo_bin("agboard"));
        command
            .current_dir(cwd)
            .env_clear()
            .env("AGBOARD_HOME", self.data())
            .env("HOME", self.base().join("home"))
            .env("CODEX_HOME", self.base().join("codex"))
            .env("CLAUDE_CONFIG_DIR", self.claude())
            .env("PATH", self.base().join("bin"))
            .env("TZ", "UTC");
        command
    }

    /// A non-interactive run: (exit code, stdout, stderr).
    pub fn agboard(&self, args: &[&str], cwd: &Path) -> (i32, String, String) {
        let mut command = self.command(cwd);
        command.args(args).stdin(Stdio::null());
        let output = {
            let _spawn = SPAWN.read().unwrap_or_else(|e| e.into_inner());
            command.output().unwrap()
        };
        (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }

    pub fn session(&self, cwd: &Path, args: &[&str]) -> Session {
        let mut command = self.command(cwd);
        command.args(args);
        let mut session = {
            let _spawn = SPAWN.read().unwrap_or_else(|e| e.into_inner());
            expectrl::Session::spawn(command).unwrap()
        };
        session.set_expect_timeout(Some(Duration::from_secs(20)));
        session
    }

    /// Holds `agent`'s lock until the guard is dropped; no child is spawned meanwhile.
    pub fn hold_lock(&self, agent: Agent) -> HeldLock {
        let spawn = SPAWN.write().unwrap_or_else(|e| e.into_inner());
        let lock =
            agent_board::integrations::journal::AgentLock::acquire(&self.data(), agent).unwrap();
        HeldLock {
            _lock: lock,
            _spawn: spawn,
        }
    }

    /// Both agents, one scope pair (`1` Global, `2` Project), from `cwd`.
    pub fn connect_both_at(&self, cwd: &Path, skill: &str, hook: &str) {
        let (code, screen) = self.connect_screen_at(cwd, skill, hook);
        assert_eq!(code, 0, "{screen}");
    }

    /// The same, returning the exit code and everything connect printed.
    pub fn connect_screen_at(&self, cwd: &Path, skill: &str, hook: &str) -> (i32, String) {
        let mut term = self.session(cwd, &["connect"]);
        let mut screen = String::new();
        for (prompt, reply) in [
            ("Select agents", "1 2"),
            ("Skill scope", skill),
            ("Hook scope", hook),
            (CONFIRM, "y"),
        ] {
            screen.push_str(&answer(&mut term, prompt, reply, &screen));
        }
        let (code, rest) = finish(term);
        screen.push_str(&rest);
        (code, screen)
    }

    pub fn connect_both(&self, skill: &str, hook: &str) {
        self.connect_both_at(&self.root(), skill, hook);
    }

    pub fn read_registry(&self) -> Registry {
        Registry::read(&self.registry_file()).unwrap().unwrap()
    }

    /// Rewrites the registry through `change`.
    pub fn edit_registry(&self, change: impl FnOnce(&mut Registry)) {
        let mut registry = self.read_registry();
        change(&mut registry);
        fs::write(self.registry_file(), registry.to_json()).unwrap();
    }

    /// Makes the records chosen by `which` look like an older installation:
    /// the version is `version`, and a Skill's first file holds older bytes.
    pub fn age(&self, version: &str, which: impl Fn(&InstallationRecord) -> bool) {
        self.edit_registry(|registry| {
            for record in registry.installations.iter_mut().filter(|r| which(r)) {
                record.installed_version = version.to_string();
                if record.component == Component::Skill {
                    let file = &mut record.files[0];
                    let bytes = b"an older release of this file\n";
                    fs::write(record.resolved_path.join(&file.path), bytes).unwrap();
                    file.sha256 = sha256_hex(bytes);
                    record.managed_hash = skill_manifest_hash(&record.files);
                }
            }
        });
    }

    /// Only the version, with the files as the current build wrote them.
    pub fn age_version_only(&self, version: &str) {
        self.edit_registry(|registry| {
            for record in &mut registry.installations {
                record.installed_version = version.to_string();
            }
        });
    }

    /// Makes the recorded Hook of `agent` an older one: the group on disk and
    /// its record carry an extra key that the current template does not have.
    pub fn age_hook(&self, agent: Agent) {
        self.edit_registry(|registry| {
            let record = registry
                .installations
                .iter_mut()
                .find(|r| r.agent == agent && r.component == Component::Hook)
                .unwrap();
            let mut settings: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&record.resolved_path).unwrap()).unwrap();
            for entry in &mut record.managed_entries {
                let groups = settings["hooks"][&entry.event].as_array_mut().unwrap();
                let group = groups
                    .iter_mut()
                    .find(|g| g["hooks"][0]["command"] == entry.command.as_str())
                    .unwrap();
                group["statusMessage"] = "an older hook".into();
                entry.sha256 = sha256_hex(canonical_json(group).as_bytes());
            }
            record.managed_hash = hook_manifest_hash(&record.managed_entries);
            fs::write(
                &record.resolved_path,
                serde_json::to_string_pretty(&settings).unwrap(),
            )
            .unwrap();
        });
    }

    /// Runs the Global/Global connect plan of `agent` in this world and dies
    /// at the registry commit, leaving the files written and the journal
    /// pending, as a killed `agboard` would.
    pub fn interrupted_run(&self, agent: Agent) {
        // The run holds the agent lock; no child may be spawned meanwhile.
        let _spawn = SPAWN.write().unwrap_or_else(|e| e.into_inner());
        let env = PathEnv {
            agboard_home: Some(self.data().into()),
            home: Some(self.base().join("home")),
            codex_home: Some(self.base().join("codex").into()),
            claude_config_dir: Some(self.claude().into()),
        };
        let targets = resolve_targets(
            &env,
            agent,
            Scope::Global,
            Scope::Global,
            Some(&self.root()),
        )
        .unwrap();
        let registry = Registry::read(&self.registry_file())
            .unwrap()
            .unwrap_or_default();
        let bundle = agent_board::integrations::assets::bundle().unwrap();
        let plan = plan_agent(&PlanInput {
            env: &env,
            targets: &targets,
            project_id: None,
            project_name: None,
            scan_root: Some(&self.root()),
            registry: &registry,
            bundle: &bundle,
            permissions: true,
            moves: true,
        })
        .unwrap();
        let crash = |step: &Step| {
            if step.phase == agent_board::integrations::apply::Phase::Registry {
                StepAction::Crash
            } else {
                StepAction::Continue
            }
        };
        let outcome = apply_agent(
            &env,
            &plan,
            &ApplyOptions {
                observer: Some(&crash),
            },
        );
        assert_eq!(outcome.status, Status::Interrupted, "{outcome:?}");
    }

    pub fn journal(&self, agent: Agent) -> PathBuf {
        self.data()
            .join(format!("integrations-journal-{}.json", agent.key()))
    }

    pub fn skill_dir(&self, agent: Agent, project: bool) -> PathBuf {
        match (agent, project) {
            (Agent::Claude, false) => self.claude().join("skills/agent-board"),
            (Agent::Claude, true) => self.root().join(".claude/skills/agent-board"),
            (Agent::Codex, false) => self.base().join("home/.agents/skills/agent-board"),
            (Agent::Codex, true) => self.root().join(".agents/skills/agent-board"),
        }
    }
}

pub fn finish(mut term: Session) -> (i32, String) {
    let rest = term.expect(Eof).unwrap();
    let text = String::from_utf8_lossy(rest.as_bytes()).into_owned();
    match term.get_process().wait().unwrap() {
        WaitStatus::Exited(_, code) => (code, text),
        other => panic!("unexpected end: {other:?}\n{text}"),
    }
}

/// Every file below `dir` with its bytes.
pub fn world(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
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

/// The backups below `dir`.
pub fn backups(dir: &Path) -> Vec<PathBuf> {
    world(dir)
        .into_keys()
        .filter(|p| p.to_string_lossy().contains("agboard-backup"))
        .collect()
}

pub fn skill_text(dir: &Path) -> String {
    fs::read_to_string(dir.join("SKILL.md")).unwrap()
}
