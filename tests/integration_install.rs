//! Focused tests for planning and applying the Skill and Hook installation:
//! merging into existing settings, conflicts, duplicates, scope moves, reruns,
//! and the independence of the two agents. Every case runs in a temporary
//! directory with its own AGBOARD_HOME, CODEX_HOME, and CLAUDE_CONFIG_DIR; the
//! real home and agent settings are never read or written.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use agent_board::integrations::apply::{
    AgentOutcome, ApplyOptions, Phase, Status, StepAction, apply_agent, apply_all, exit_code,
    is_partial,
};
use agent_board::integrations::assets::bundle;
use agent_board::integrations::merge::ConflictKind;
use agent_board::integrations::paths::{PathEnv, placement, registry_path, resolve_targets};
use agent_board::integrations::plan::{AgentPlan, PlanInput, PlanState, plan_agent};
use agent_board::integrations::registry::Registry;
use agent_board::integrations::{Agent, Component, Scope};
use serde_json::{Value, json};

const CODEX_CONFIG: &str = "sandbox_mode = \"workspace-write\"\n";

struct Fx {
    _tmp: tempfile::TempDir,
    env: PathEnv,
    root: PathBuf,
}

fn fixture() -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().canonicalize().unwrap();
    for dir in ["home", "data", "codex", "claude", "project"] {
        fs::create_dir_all(base.join(dir)).unwrap();
    }
    fs::write(base.join("codex/config.toml"), CODEX_CONFIG).unwrap();
    let env = PathEnv {
        agboard_home: Some(OsString::from(base.join("data"))),
        home: Some(base.join("home")),
        codex_home: Some(OsString::from(base.join("codex"))),
        claude_config_dir: Some(OsString::from(base.join("claude"))),
    };
    let root = base.join("project");
    Fx {
        _tmp: tmp,
        env,
        root,
    }
}

fn plan_for(fx: &Fx, agent: Agent, skill: Scope, hook: Scope) -> AgentPlan {
    let registry = Registry::read(&registry_path(&fx.env).unwrap())
        .unwrap()
        .unwrap_or_default();
    let targets = resolve_targets(&fx.env, agent, skill, hook, Some(&fx.root)).unwrap();
    let bundle = bundle().unwrap();
    plan_agent(&PlanInput {
        env: &fx.env,
        targets: &targets,
        project_id: Some("proj"),
        scan_root: Some(&fx.root),
        registry: &registry,
        bundle: &bundle,
        permissions: true,
    })
    .unwrap()
}

fn connect(fx: &Fx, agent: Agent, skill: Scope, hook: Scope) -> AgentOutcome {
    apply_agent(
        &fx.env,
        &plan_for(fx, agent, skill, hook),
        &ApplyOptions::default(),
    )
}

fn place(fx: &Fx, agent: Agent, component: Component, scope: Scope) -> PathBuf {
    placement(&fx.env, agent, component, scope, Some(&fx.root)).unwrap()
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// Every file below `dir` with its bytes.
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
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

fn backups(fx: &Fx) -> Vec<PathBuf> {
    let base = fx.root.parent().unwrap();
    snapshot(base)
        .into_keys()
        .filter(|p| p.to_string_lossy().contains("agboard-backup"))
        .collect()
}

/// How many `agboard hook` commands the settings file holds.
fn agboard_commands(path: &Path) -> usize {
    fs::read_to_string(path)
        .map(|t| t.matches("agboard hook").count())
        .unwrap_or(0)
}

#[test]
fn both_agents_get_skill_hook_and_permissions() {
    let fx = fixture();
    let outcomes = apply_all(
        &fx.env,
        &[
            plan_for(&fx, Agent::Codex, Scope::Global, Scope::Global),
            plan_for(&fx, Agent::Claude, Scope::Global, Scope::Global),
        ],
        &ApplyOptions::default(),
    );
    assert_eq!(
        outcomes.iter().map(|o| o.agent).collect::<Vec<_>>(),
        [Agent::Claude, Agent::Codex]
    );
    assert_eq!(exit_code(&outcomes), 0, "{outcomes:?}");
    for agent in Agent::ALL {
        assert!(
            place(&fx, agent, Component::Skill, Scope::Global)
                .join("SKILL.md")
                .is_file()
        );
        assert!(agboard_commands(&place(&fx, agent, Component::Hook, Scope::Global)) > 0);
    }
    let settings = read_json(&fx.root.parent().unwrap().join("claude/settings.json"));
    let data = fx
        .root
        .parent()
        .unwrap()
        .join("data")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        settings["permissions"]["additionalDirectories"],
        json!([data])
    );
    let toml = fs::read_to_string(fx.root.parent().unwrap().join("codex/config.toml")).unwrap();
    assert!(toml.contains(&data) && toml.contains("workspace-write"));
    let registry = Registry::read(&registry_path(&fx.env).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(registry.installations.len(), 4);
}

#[test]
fn skill_and_hook_scopes_are_independent_in_both_directions() {
    for (skill, hook) in [
        (Scope::Global, Scope::Project),
        (Scope::Project, Scope::Global),
    ] {
        let fx = fixture();
        for agent in Agent::ALL {
            assert_eq!(
                connect(&fx, agent, skill, hook).status,
                Status::Applied,
                "{agent:?}"
            );
            assert!(
                place(&fx, agent, Component::Skill, skill)
                    .join("SKILL.md")
                    .is_file()
            );
            assert!(agboard_commands(&place(&fx, agent, Component::Hook, hook)) > 0);
            let other_skill = place(&fx, agent, Component::Skill, hook);
            let other_hook = place(&fx, agent, Component::Hook, skill);
            assert!(!other_skill.exists());
            assert_eq!(agboard_commands(&other_hook), 0);
        }
    }
}

#[test]
fn sibling_settings_and_user_hooks_are_preserved() {
    let fx = fixture();
    let path = place(&fx, Agent::Claude, Component::Hook, Scope::Global);
    let original = json!({
        "model": "sentinel",
        "futureKey": {"x": 1},
        "permissions": {"allow": ["Read"], "defaultMode": "acceptEdits", "additionalDirectories": ["/other"]},
        "hooks": {
            "Stop": [{"hooks": [{"type": "command", "command": "my-stop"}]}],
            "PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "my-lint"}]}]
        }
    });
    fs::write(&path, serde_json::to_string_pretty(&original).unwrap()).unwrap();
    assert_eq!(
        connect(&fx, Agent::Claude, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    let after = read_json(&path);
    assert_eq!(after["model"], "sentinel");
    assert_eq!(after["futureKey"], json!({"x": 1}));
    assert_eq!(after["permissions"]["allow"], json!(["Read"]));
    assert_eq!(after["permissions"]["defaultMode"], "acceptEdits");
    assert_eq!(after["hooks"]["Stop"], original["hooks"]["Stop"]);
    let post = after["hooks"]["PostToolUse"].as_array().unwrap();
    assert!(
        post.contains(&original["hooks"]["PostToolUse"][0]),
        "the user's own hook stays"
    );
    assert_eq!(post.len(), 2);
    let dirs = after["permissions"]["additionalDirectories"]
        .as_array()
        .unwrap();
    assert_eq!(dirs.len(), 2);
    assert_eq!(dirs[0], "/other");
}

#[test]
fn rerun_changes_nothing_and_creates_no_backup() {
    let fx = fixture();
    for agent in Agent::ALL {
        assert_eq!(
            connect(&fx, agent, Scope::Global, Scope::Project).status,
            Status::Applied
        );
    }
    let base = fx.root.parent().unwrap().to_path_buf();
    let before = snapshot(&base);
    let backups_before = backups(&fx);
    for agent in Agent::ALL {
        let plan = plan_for(&fx, agent, Scope::Global, Scope::Project);
        assert_eq!(plan.state(), PlanState::Unchanged, "{agent:?}: {plan:?}");
        assert_eq!(
            apply_agent(&fx.env, &plan, &ApplyOptions::default()).status,
            Status::Unchanged
        );
    }
    assert_eq!(
        snapshot(&base),
        before,
        "no file changed, including the registry"
    );
    assert_eq!(backups(&fx), backups_before);
    let hook = place(&fx, Agent::Claude, Component::Hook, Scope::Project);
    assert_eq!(
        read_json(&hook)["hooks"]["PostToolUse"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn unrelated_edits_are_not_conflicts_but_managed_edits_are() {
    let fx = fixture();
    assert_eq!(
        connect(&fx, Agent::Claude, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    let path = place(&fx, Agent::Claude, Component::Hook, Scope::Global);
    let mut value = read_json(&path);
    value["model"] = json!("changed-by-user");
    fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
    let plan = plan_for(&fx, Agent::Claude, Scope::Global, Scope::Global);
    assert_eq!(
        plan.state(),
        PlanState::Unchanged,
        "an unrelated key is the user's"
    );

    value["hooks"]["PostToolUse"][0]["hooks"][0]["timeout"] = json!(99);
    let edited = serde_json::to_string(&value).unwrap();
    fs::write(&path, &edited).unwrap();
    let outcome = connect(&fx, Agent::Claude, Scope::Global, Scope::Global);
    assert_eq!(outcome.status, Status::Blocked);
    assert!(
        outcome
            .conflicts
            .iter()
            .any(|c| c.kind == ConflictKind::ModifiedManaged)
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        edited,
        "the user's edit stays"
    );

    let mut gone = read_json(&path);
    gone["hooks"].as_object_mut().unwrap().remove("PostToolUse");
    fs::write(&path, serde_json::to_string(&gone).unwrap()).unwrap();
    let outcome = connect(&fx, Agent::Claude, Scope::Global, Scope::Global);
    assert!(
        outcome
            .conflicts
            .iter()
            .any(|c| c.kind == ConflictKind::MissingManaged)
    );
}

#[test]
fn skill_conflicts_protect_user_content() {
    let fx = fixture();
    let skill = place(&fx, Agent::Codex, Component::Skill, Scope::Global);
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("mine.md"), "mine").unwrap();
    let outcome = connect(&fx, Agent::Codex, Scope::Global, Scope::Global);
    assert!(
        outcome
            .conflicts
            .iter()
            .any(|c| c.kind == ConflictKind::UnmanagedSkill)
    );
    assert_eq!(fs::read_to_string(skill.join("mine.md")).unwrap(), "mine");
    assert!(!skill.join("SKILL.md").exists());
    fs::remove_dir_all(&skill).unwrap();

    assert_eq!(
        connect(&fx, Agent::Codex, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    fs::write(skill.join("extra.md"), "added").unwrap();
    let kinds = |o: &AgentOutcome| o.conflicts.iter().map(|c| c.kind).collect::<Vec<_>>();
    assert_eq!(
        kinds(&connect(&fx, Agent::Codex, Scope::Global, Scope::Global)),
        [ConflictKind::SkillExtraFile]
    );
    fs::remove_file(skill.join("extra.md")).unwrap();
    fs::write(skill.join("SKILL.md"), "edited").unwrap();
    assert_eq!(
        kinds(&connect(&fx, Agent::Codex, Scope::Global, Scope::Global)),
        [ConflictKind::SkillModified]
    );
    assert_eq!(
        fs::read_to_string(skill.join("SKILL.md")).unwrap(),
        "edited"
    );
    fs::remove_dir_all(&skill).unwrap();
    std::os::unix::fs::symlink(fx.root.join("elsewhere"), &skill).unwrap();
    assert_eq!(
        kinds(&connect(&fx, Agent::Codex, Scope::Global, Scope::Global)),
        [ConflictKind::Symlink]
    );
}

#[test]
fn unmanaged_and_suspicious_registrations_stop_the_agent() {
    let cases: [(&str, ConflictKind); 3] = [
        (
            "agboard hook --agent claude",
            ConflictKind::UnmanagedDuplicate,
        ),
        (
            "/opt/bin/agboard hook --agent claude",
            ConflictKind::Suspicious,
        ),
        (
            "sh -c 'agboard hook --agent claude; true'",
            ConflictKind::Suspicious,
        ),
    ];
    for (command, kind) in cases {
        let fx = fixture();
        let global = place(&fx, Agent::Claude, Component::Hook, Scope::Global);
        let group = json!({"hooks": [{"type": "command", "command": command}]});
        let original = serde_json::to_string(&json!({"hooks": {"PostToolUse": [group]}})).unwrap();
        fs::write(&global, &original).unwrap();
        let outcome = connect(&fx, Agent::Claude, Scope::Global, Scope::Project);
        assert_eq!(outcome.status, Status::Blocked, "{command}");
        assert!(
            outcome.conflicts.iter().any(|c| c.kind == kind),
            "{command}: {:?}",
            outcome.conflicts
        );
        assert_eq!(
            fs::read_to_string(&global).unwrap(),
            original,
            "nothing is deleted or adopted"
        );
        assert!(!place(&fx, Agent::Claude, Component::Hook, Scope::Project).exists());
        assert!(!place(&fx, Agent::Claude, Component::Skill, Scope::Global).exists());
    }
}

#[test]
fn local_settings_and_codex_inline_hooks_count_as_duplicates() {
    let fx = fixture();
    let local = fx.root.join(".claude/settings.local.json");
    fs::create_dir_all(local.parent().unwrap()).unwrap();
    fs::write(&local, r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"agboard hook --agent claude"}]}]}}"#).unwrap();
    let outcome = connect(&fx, Agent::Claude, Scope::Global, Scope::Global);
    assert_eq!(outcome.status, Status::Blocked);

    let toml = format!(
        "{CODEX_CONFIG}\n[[hooks.PostToolUse]]\n[[hooks.PostToolUse.hooks]]\ntype = \"command\"\ncommand = \"agboard hook --agent codex\"\n"
    );
    fs::write(fx.root.parent().unwrap().join("codex/config.toml"), toml).unwrap();
    let outcome = connect(&fx, Agent::Codex, Scope::Global, Scope::Global);
    assert_eq!(outcome.status, Status::Blocked);
    assert!(!outcome.conflicts.is_empty());
}

#[test]
fn moving_the_hook_scope_previews_and_moves_in_one_transaction() {
    let fx = fixture();
    let global = place(&fx, Agent::Claude, Component::Hook, Scope::Global);
    let user_hook = json!({"hooks": [{"type": "command", "command": "my-stop"}]});
    fs::write(
        &global,
        serde_json::to_string(&json!({"hooks": {"Stop": [user_hook]}})).unwrap(),
    )
    .unwrap();
    assert_eq!(
        connect(&fx, Agent::Claude, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    let plan = plan_for(&fx, Agent::Claude, Scope::Global, Scope::Project);
    assert_eq!(plan.state(), PlanState::Ready);
    assert!(
        plan.removals
            .iter()
            .any(|r| r.contains("PostToolUse") && r.contains(global.to_str().unwrap())),
        "{:?}",
        plan.removals
    );
    assert!(plan.additions.iter().any(|a| a.contains("PostToolUse")));
    let outcome = apply_agent(&fx.env, &plan, &ApplyOptions::default());
    assert_eq!(outcome.status, Status::Applied, "{outcome:?}");
    assert_eq!(
        agboard_commands(&global),
        0,
        "the Global registration is gone"
    );
    assert_eq!(
        read_json(&global)["hooks"]["Stop"],
        json!([user_hook]),
        "the user's hook stays"
    );
    assert!(agboard_commands(&place(&fx, Agent::Claude, Component::Hook, Scope::Project)) > 0);
    let registry = Registry::read(&registry_path(&fx.env).unwrap())
        .unwrap()
        .unwrap();
    let hooks: Vec<_> = registry
        .installations
        .iter()
        .filter(|r| r.component == Component::Hook)
        .collect();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0].scope, Scope::Project);

    // and back to Global
    assert_eq!(
        connect(&fx, Agent::Claude, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    assert_eq!(
        agboard_commands(&place(&fx, Agent::Claude, Component::Hook, Scope::Project)),
        0
    );
    assert!(agboard_commands(&global) > 0);
}

#[test]
fn moving_the_skill_scope_removes_the_old_managed_directory() {
    let fx = fixture();
    assert_eq!(
        connect(&fx, Agent::Codex, Scope::Global, Scope::Global).status,
        Status::Applied
    );
    let old = place(&fx, Agent::Codex, Component::Skill, Scope::Global);
    let plan = plan_for(&fx, Agent::Codex, Scope::Project, Scope::Global);
    assert!(
        plan.removals
            .iter()
            .any(|r| r.contains(old.to_str().unwrap()))
    );
    assert_eq!(
        apply_agent(&fx.env, &plan, &ApplyOptions::default()).status,
        Status::Applied
    );
    assert!(!old.exists());
    assert!(
        place(&fx, Agent::Codex, Component::Skill, Scope::Project)
            .join("SKILL.md")
            .is_file()
    );
}

#[test]
fn a_codex_setup_that_cannot_be_automated_leaves_that_agent_alone() {
    let fx = fixture();
    let config = fx.root.parent().unwrap().join("codex/config.toml");
    fs::write(&config, "sandbox_mode = \"read-only\"\n").unwrap();
    let outcomes = apply_all(
        &fx.env,
        &[
            plan_for(&fx, Agent::Claude, Scope::Global, Scope::Global),
            plan_for(&fx, Agent::Codex, Scope::Global, Scope::Global),
        ],
        &ApplyOptions::default(),
    );
    assert_eq!(outcomes[0].status, Status::Applied);
    assert_eq!(outcomes[1].status, Status::Blocked);
    assert!(
        outcomes[1]
            .manual_steps
            .iter()
            .any(|s| s.contains("sandbox_mode"))
    );
    assert_eq!(
        fs::read_to_string(&config).unwrap(),
        "sandbox_mode = \"read-only\"\n"
    );
    assert!(!place(&fx, Agent::Codex, Component::Skill, Scope::Global).exists());
    assert!(is_partial(&outcomes));
    assert_eq!(exit_code(&outcomes), 1);
}

#[test]
fn a_failing_agent_does_not_undo_the_one_that_finished() {
    let fx = fixture();
    let codex_hook = place(&fx, Agent::Codex, Component::Hook, Scope::Global);
    let seen = Cell::new(0);
    let observer = |step: &agent_board::integrations::apply::Step| {
        if step.phase == Phase::Rename && step.path == codex_hook {
            seen.set(seen.get() + 1);
            return StepAction::Fail("disk full".into());
        }
        StepAction::Continue
    };
    let outcomes = apply_all(
        &fx.env,
        &[
            plan_for(&fx, Agent::Codex, Scope::Global, Scope::Global),
            plan_for(&fx, Agent::Claude, Scope::Global, Scope::Global),
        ],
        &ApplyOptions {
            observer: Some(&observer),
        },
    );
    assert_eq!(seen.get(), 1);
    assert_eq!(
        outcomes[0].status,
        Status::Applied,
        "Claude Code runs first and stays"
    );
    assert_eq!(outcomes[1].status, Status::Failed);
    assert!(
        outcomes[1]
            .message
            .as_deref()
            .unwrap()
            .contains("disk full")
    );
    assert!(outcomes[1].rollback.as_ref().unwrap().is_clean());
    assert!(is_partial(&outcomes));
    assert_eq!(exit_code(&outcomes), 1);
    assert!(
        place(&fx, Agent::Claude, Component::Skill, Scope::Global)
            .join("SKILL.md")
            .is_file()
    );
    assert!(!codex_hook.exists());
    assert_eq!(
        fs::read_to_string(fx.root.parent().unwrap().join("codex/config.toml")).unwrap(),
        CODEX_CONFIG
    );
    let registry = Registry::read(&registry_path(&fx.env).unwrap())
        .unwrap()
        .unwrap();
    assert!(
        registry
            .installations
            .iter()
            .all(|r| r.agent == Agent::Claude)
    );
}

#[test]
fn existing_board_data_is_never_touched() {
    let fx = fixture();
    let board = fx
        .root
        .parent()
        .unwrap()
        .join("data/shared/projects/p1/tasks/1");
    fs::create_dir_all(&board).unwrap();
    fs::write(board.join("TASK.md"), "---\nhistory: []\n---\nbody\n").unwrap();
    let before = snapshot(&fx.root.parent().unwrap().join("data/shared"));
    for agent in Agent::ALL {
        assert_eq!(
            connect(&fx, agent, Scope::Global, Scope::Global).status,
            Status::Applied
        );
    }
    assert_eq!(
        snapshot(&fx.root.parent().unwrap().join("data/shared")),
        before
    );
}

#[test]
fn an_equal_hook_the_user_registered_in_the_target_file_is_not_adopted() {
    let fx = fixture();
    let path = place(&fx, Agent::Claude, Component::Hook, Scope::Global);
    let group = json!({"matcher": "startup|resume|clear|compact", "hooks": [{"type": "command", "command": "agboard   hook --agent claude", "timeout": 10}]});
    let original = serde_json::to_string(&json!({"hooks": {"SessionStart": [group]}})).unwrap();
    fs::write(&path, &original).unwrap();
    let outcome = connect(&fx, Agent::Claude, Scope::Global, Scope::Global);
    assert_eq!(outcome.status, Status::Blocked);
    assert!(
        outcome
            .conflicts
            .iter()
            .any(|c| c.kind == ConflictKind::UnmanagedDuplicate),
        "{:?}",
        outcome.conflicts
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert!(!place(&fx, Agent::Claude, Component::Skill, Scope::Global).exists());
}
