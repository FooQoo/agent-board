//! Focused tests for the pure placement functions. Fake homes and bound roots
//! are injected through `PathEnv`; the real home and environment are never
//! read, and the only file system access is in a temporary directory.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use agent_board::integrations::paths::{
    PathEnv, data_dir, placement, registry_path, resolve_links, resolve_targets,
};
use agent_board::integrations::{Agent, Component, IntegrationError, Scope};

const HOME: &str = "/fixture/home";
const BOUND: &str = "/fixture/My Projects/工場 board";

fn fake_env() -> PathEnv {
    PathEnv {
        agboard_home: None,
        home: Some(PathBuf::from(HOME)),
        codex_home: None,
        claude_config_dir: None,
    }
}

fn with_overrides(agboard_home: &str, codex_home: &str, claude_config_dir: &str) -> PathEnv {
    PathEnv {
        agboard_home: Some(OsString::from(agboard_home)),
        codex_home: Some(OsString::from(codex_home)),
        claude_config_dir: Some(OsString::from(claude_config_dir)),
        ..fake_env()
    }
}

fn place(env: &PathEnv, agent: Agent, component: Component, scope: Scope) -> PathBuf {
    placement(env, agent, component, scope, Some(Path::new(BOUND))).unwrap()
}

#[test]
fn default_placement_table_matches_the_specification() {
    let env = fake_env();
    let expected = [
        (
            Agent::Claude,
            Component::Skill,
            Scope::Global,
            format!("{HOME}/.claude/skills/agent-board"),
        ),
        (
            Agent::Claude,
            Component::Hook,
            Scope::Global,
            format!("{HOME}/.claude/settings.json"),
        ),
        (
            Agent::Codex,
            Component::Skill,
            Scope::Global,
            format!("{HOME}/.agents/skills/agent-board"),
        ),
        (
            Agent::Codex,
            Component::Hook,
            Scope::Global,
            format!("{HOME}/.codex/hooks.json"),
        ),
        (
            Agent::Claude,
            Component::Skill,
            Scope::Project,
            format!("{BOUND}/.claude/skills/agent-board"),
        ),
        (
            Agent::Claude,
            Component::Hook,
            Scope::Project,
            format!("{BOUND}/.claude/settings.json"),
        ),
        (
            Agent::Codex,
            Component::Skill,
            Scope::Project,
            format!("{BOUND}/.agents/skills/agent-board"),
        ),
        (
            Agent::Codex,
            Component::Hook,
            Scope::Project,
            format!("{BOUND}/.codex/hooks.json"),
        ),
    ];
    for (agent, component, scope, path) in expected {
        assert_eq!(
            place(&env, agent, component, scope),
            PathBuf::from(&path),
            "{agent:?} {component:?} {scope:?}"
        );
    }
}

#[test]
fn claude_config_dir_moves_only_the_claude_global_targets() {
    let env = with_overrides("", "", "/fixture/claude-config");
    assert_eq!(
        place(&env, Agent::Claude, Component::Skill, Scope::Global),
        PathBuf::from("/fixture/claude-config/skills/agent-board")
    );
    assert_eq!(
        place(&env, Agent::Claude, Component::Hook, Scope::Global),
        PathBuf::from("/fixture/claude-config/settings.json")
    );
    assert_eq!(
        place(&env, Agent::Codex, Component::Skill, Scope::Global),
        PathBuf::from(format!("{HOME}/.agents/skills/agent-board"))
    );
    assert_eq!(
        place(&env, Agent::Claude, Component::Hook, Scope::Project),
        PathBuf::from(format!("{BOUND}/.claude/settings.json")),
        "project paths ignore the override"
    );
}

#[test]
fn codex_home_moves_only_the_codex_hook_and_never_the_codex_skill() {
    let env = with_overrides("", "/fixture/codex-home", "");
    assert_eq!(
        place(&env, Agent::Codex, Component::Hook, Scope::Global),
        PathBuf::from("/fixture/codex-home/hooks.json")
    );
    assert_eq!(
        place(&env, Agent::Codex, Component::Skill, Scope::Global),
        PathBuf::from(format!("{HOME}/.agents/skills/agent-board")),
        "Codex Skills follow .agents/skills, not CODEX_HOME"
    );
    assert_eq!(
        place(&env, Agent::Claude, Component::Hook, Scope::Global),
        PathBuf::from(format!("{HOME}/.claude/settings.json"))
    );
}

#[test]
fn empty_overrides_count_as_unset() {
    let env = with_overrides("", "", "");
    assert_eq!(
        place(&env, Agent::Codex, Component::Hook, Scope::Global),
        PathBuf::from(format!("{HOME}/.codex/hooks.json"))
    );
    assert_eq!(
        place(&env, Agent::Claude, Component::Skill, Scope::Global),
        PathBuf::from(format!("{HOME}/.claude/skills/agent-board"))
    );
    assert_eq!(
        registry_path(&env).unwrap(),
        PathBuf::from(format!("{HOME}/.agent-board/integrations.json"))
    );
}

#[test]
fn registry_lives_in_the_data_directory_and_honors_agboard_home() {
    assert_eq!(
        data_dir(&fake_env()).unwrap(),
        PathBuf::from(format!("{HOME}/.agent-board"))
    );
    let env = with_overrides("/fixture/data area", "", "");
    assert_eq!(data_dir(&env).unwrap(), PathBuf::from("/fixture/data area"));
    assert_eq!(
        registry_path(&env).unwrap(),
        PathBuf::from("/fixture/data area/integrations.json")
    );
    assert!(
        !registry_path(&env)
            .unwrap()
            .starts_with(PathBuf::from("/fixture/data area").join("shared")),
        "the registry is kept out of the shared folders"
    );
}

#[test]
fn project_scope_needs_an_absolute_bound_root() {
    let env = fake_env();
    assert_eq!(
        placement(&env, Agent::Claude, Component::Hook, Scope::Project, None),
        Err(IntegrationError::BindingRequired)
    );
    assert_eq!(
        placement(
            &env,
            Agent::Claude,
            Component::Hook,
            Scope::Project,
            Some(Path::new("relative/project"))
        ),
        Err(IntegrationError::NotAbsolute(PathBuf::from(
            "relative/project"
        )))
    );
    // Global placement ignores the bound root entirely.
    assert_eq!(
        placement(&env, Agent::Claude, Component::Hook, Scope::Global, None).unwrap(),
        PathBuf::from(format!("{HOME}/.claude/settings.json"))
    );
}

#[test]
fn skill_and_hook_scopes_resolve_independently_in_both_directions() {
    let env = fake_env();
    let bound = Path::new(BOUND);

    let claude = resolve_targets(
        &env,
        Agent::Claude,
        Scope::Global,
        Scope::Project,
        Some(bound),
    )
    .unwrap();
    assert_eq!(claude.agent, Agent::Claude);
    assert_eq!(claude.skill_scope, Scope::Global);
    assert_eq!(claude.hook_scope, Scope::Project);
    assert_eq!(claude.bound_root.as_deref(), Some(bound));
    assert_eq!(
        claude.effective_paths.skill,
        PathBuf::from(format!("{HOME}/.claude/skills/agent-board"))
    );
    assert_eq!(
        claude.effective_paths.hook,
        PathBuf::from(format!("{BOUND}/.claude/settings.json"))
    );

    let codex = resolve_targets(
        &env,
        Agent::Codex,
        Scope::Project,
        Scope::Global,
        Some(bound),
    )
    .unwrap();
    assert_eq!(codex.skill_scope, Scope::Project);
    assert_eq!(codex.hook_scope, Scope::Global);
    assert_eq!(
        codex.effective_paths.skill,
        PathBuf::from(format!("{BOUND}/.agents/skills/agent-board"))
    );
    assert_eq!(
        codex.effective_paths.hook,
        PathBuf::from(format!("{HOME}/.codex/hooks.json"))
    );
}

#[test]
fn an_all_global_placement_needs_no_bound_root() {
    let env = fake_env();
    let targets = resolve_targets(&env, Agent::Codex, Scope::Global, Scope::Global, None).unwrap();
    assert_eq!(targets.bound_root, None);
    assert_eq!(
        resolve_targets(&env, Agent::Codex, Scope::Project, Scope::Global, None),
        Err(IntegrationError::BindingRequired)
    );
}

#[test]
fn project_paths_keep_spaces_and_non_ascii_names_of_the_bound_root() {
    let env = fake_env();
    let root = Path::new("/fixture/我的 プロジェクト/a b");
    let hook = placement(
        &env,
        Agent::Codex,
        Component::Hook,
        Scope::Project,
        Some(root),
    )
    .unwrap();
    assert_eq!(hook, root.join(".codex").join("hooks.json"));
    let skill = placement(
        &env,
        Agent::Claude,
        Component::Skill,
        Scope::Project,
        Some(root),
    )
    .unwrap();
    assert_eq!(
        skill,
        root.join(".claude").join("skills").join("agent-board")
    );
}

#[test]
fn a_missing_home_fails_only_for_targets_that_need_it() {
    let no_home = PathEnv {
        home: None,
        ..with_overrides("", "/fixture/codex-home", "/fixture/claude-config")
    };
    assert_eq!(
        placement(&no_home, Agent::Codex, Component::Hook, Scope::Global, None).unwrap(),
        PathBuf::from("/fixture/codex-home/hooks.json")
    );
    assert_eq!(
        placement(
            &no_home,
            Agent::Claude,
            Component::Hook,
            Scope::Global,
            None
        )
        .unwrap(),
        PathBuf::from("/fixture/claude-config/settings.json")
    );
    assert!(matches!(
        placement(
            &no_home,
            Agent::Codex,
            Component::Skill,
            Scope::Global,
            None
        ),
        Err(IntegrationError::NoHome { .. })
    ));
    assert!(matches!(
        data_dir(&no_home),
        Err(IntegrationError::Board(_))
    ));
}

#[test]
fn resolve_links_follows_an_existing_symbolic_link() {
    let tmp = tempfile::tempdir().unwrap();
    let real = tmp.path().join("real project");
    std::fs::create_dir_all(&real).unwrap();
    let link = tmp.path().join("linked");
    std::os::unix::fs::symlink(&real, &link).unwrap();

    let resolved = resolve_links(&link.join(".claude").join("skills").join("agent-board"));
    let expected = std::fs::canonicalize(&real)
        .unwrap()
        .join(".claude")
        .join("skills")
        .join("agent-board");
    assert_eq!(resolved, expected);
}
