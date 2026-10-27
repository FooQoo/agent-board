//! Focused tests for `agboard update`: the confirmation, `--yes`, conflicts,
//! reruns, the version-only update, the reach (Global plus the current bound
//! root), and the exit codes. Every case has its own temporary AGBOARD_HOME,
//! CODEX_HOME, CLAUDE_CONFIG_DIR, and HOME.

#![cfg(unix)]

mod update_fixture;

use std::fs;
use std::io::Write;
use std::process::Stdio;

use agent_board::integrations::assets::sha256_hex;
use agent_board::integrations::registry::InstallationRecord;
use agent_board::integrations::{Agent, Component, Scope};
use expectrl::Expect;
use update_fixture::{Fx, backups, finish, world};

const CURRENT: &str = env!("CARGO_PKG_VERSION");

fn record(fx: &Fx, agent: Agent, component: Component, scope: Scope) -> InstallationRecord {
    fx.read_registry()
        .installations
        .into_iter()
        .find(|r| {
            r.agent == agent
                && r.component == component
                && r.scope == scope
                && (scope == Scope::Global || r.bound_root.as_deref() == Some(fx.root().as_path()))
        })
        .unwrap_or_else(|| panic!("no {agent:?} {component:?} {scope:?} record"))
}

/// Whether the Skill on disk is the aged one (true) or matches its record
/// from the current build (false).
fn skill_is_old(fx: &Fx, agent: Agent, project: bool) -> bool {
    let dir = fx.skill_dir(agent, project);
    let scope = if project {
        Scope::Project
    } else {
        Scope::Global
    };
    let rec = record(fx, agent, Component::Skill, scope);
    let bytes = fs::read(dir.join(&rec.files[0].path)).unwrap();
    bytes == b"an older release of this file\n"
}

fn skill_matches_record(fx: &Fx, agent: Agent, project: bool) -> bool {
    let dir = fx.skill_dir(agent, project);
    let scope = if project {
        Scope::Project
    } else {
        Scope::Global
    };
    let rec = record(fx, agent, Component::Skill, scope);
    rec.files
        .iter()
        .all(|f| sha256_hex(&fs::read(dir.join(&f.path)).unwrap()) == f.sha256)
}

#[test]
fn update_yes_refreshes_an_old_install_and_keeps_the_scopes() {
    let fx = Fx::new();
    fx.connect_both("1", "2");
    fx.age("0.0.1", |_| true);
    assert!(skill_is_old(&fx, Agent::Claude, false));
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(stdout.contains("Claude Code: updated."), "{stdout}");
    assert!(stdout.contains("Codex: updated."), "{stdout}");
    assert!(!skill_is_old(&fx, Agent::Claude, false));
    assert!(!skill_is_old(&fx, Agent::Codex, false));
    // The scopes and the versions in the record.
    for agent in Agent::ALL {
        let skill = record(&fx, agent, Component::Skill, Scope::Global);
        let hook = record(&fx, agent, Component::Hook, Scope::Project);
        assert_eq!(skill.installed_version, CURRENT);
        assert_eq!(hook.installed_version, CURRENT);
        assert_eq!(hook.bound_root.as_deref(), Some(fx.root().as_path()));
    }
    assert!(skill_matches_record(&fx, Agent::Claude, false));
    // The replaced Skill folder was backed up first.
    assert!(!backups(&fx.base()).is_empty());
    assert!(stderr.is_empty(), "{stderr}");
}

#[test]
fn a_terminal_run_shows_the_diff_and_waits_for_y() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    let mut term = fx.session(&fx.root(), &["update"]);
    let seen = term.expect("[y/N]").unwrap();
    let before = String::from_utf8_lossy(seen.as_bytes()).into_owned();
    assert!(before.contains("0.0.1 -> "), "{before}");
    assert!(before.contains("Claude Code"), "{before}");
    // Nothing is written while the question is open.
    assert!(skill_is_old(&fx, Agent::Claude, false));
    term.send_line("y").unwrap();
    let (code, rest) = finish(term);
    assert_eq!(code, 0, "{rest}");
    assert!(!skill_is_old(&fx, Agent::Claude, false));
}

#[test]
fn answering_no_or_nothing_cancels_with_zero_and_no_change() {
    for answer in ["n", ""] {
        let fx = Fx::new();
        fx.connect_both("1", "1");
        fx.age("0.0.1", |_| true);
        let before = world(&fx.base());
        let mut term = fx.session(&fx.root(), &["update"]);
        term.expect("[y/N]").unwrap();
        term.send_line(answer).unwrap();
        let (code, rest) = finish(term);
        assert_eq!(code, 0, "{rest}");
        assert!(rest.contains("Cancelled"), "{rest}");
        assert_eq!(world(&fx.base()), before);
    }
}

#[test]
fn without_a_terminal_and_without_yes_it_is_a_usage_error_even_when_nothing_is_old() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    let before = world(&fx.base());
    // Current install: there is nothing to update, and it still refuses.
    let mut child = fx
        .command(&fx.root())
        .arg("update")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(b"y\ny\n").ok();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--yes"), "{stderr}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn bad_arguments_json_and_dry_run_are_usage_errors_and_write_nothing() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    let before = world(&fx.base());
    for args in [
        vec!["update", "--yes", "--json"],
        vec!["--json", "update", "--yes"],
        vec!["update", "--json"],
        vec!["update", "--dry-run"],
        vec!["update", "--yes", "--dry-run"],
        vec!["update", "extra", "--yes"],
        vec!["update", "--unknown"],
        vec!["--project", "Demo", "update", "--yes"],
    ] {
        let (code, stdout, stderr) = fx.agboard(&args, &fx.root());
        assert_eq!(code, 2, "{args:?}: {stdout}{stderr}");
        assert!(!stderr.is_empty(), "{args:?}");
    }
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn an_edited_managed_skill_file_is_a_conflict_even_with_yes() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    // Claude's managed Skill file was edited by the user; Codex is untouched.
    let rec = record(&fx, Agent::Claude, Component::Skill, Scope::Global);
    let edited = fx.skill_dir(Agent::Claude, false).join(&rec.files[0].path);
    fs::write(&edited, "my own notes\n").unwrap();
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 1, "{stdout}{stderr}");
    assert_eq!(fs::read_to_string(&edited).unwrap(), "my own notes\n");
    assert!(stderr.contains("Claude Code: not updated"), "{stderr}");
    assert!(stderr.contains(edited.to_str().unwrap()), "{stderr}");
    // The independent agent got its safe update: a partial success.
    assert!(stdout.contains("Codex: updated."), "{stdout}");
    assert!(!skill_is_old(&fx, Agent::Codex, false));
}

#[test]
fn when_every_agent_conflicts_the_reasons_go_to_standard_error() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    // Both agents' managed Skill files were edited, so no agent can update.
    let mut edited = Vec::new();
    for agent in [Agent::Claude, Agent::Codex] {
        let rec = record(&fx, agent, Component::Skill, Scope::Global);
        let path = fx.skill_dir(agent, false).join(&rec.files[0].path);
        fs::write(&path, "my own notes\n").unwrap();
        edited.push(path);
    }
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 1, "{stdout}{stderr}");
    assert!(stdout.contains("Nothing can be updated"), "{stdout}");
    assert!(stderr.contains("Claude Code: not updated"), "{stderr}");
    assert!(stderr.contains("Codex: not updated"), "{stderr}");
    for path in &edited {
        assert_eq!(fs::read_to_string(path).unwrap(), "my own notes\n");
        assert!(stderr.contains(path.to_str().unwrap()), "{stderr}");
    }
}

#[test]
fn deleted_and_replaced_managed_content_is_a_conflict() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    fs::remove_dir_all(fx.skill_dir(Agent::Claude, false)).unwrap();
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 1, "{stdout}{stderr}");
    assert!(!fx.skill_dir(Agent::Claude, false).exists());
    assert!(stderr.contains("Claude Code"), "{stderr}");
}

#[test]
fn a_rerun_changes_nothing_and_adds_no_backup() {
    let fx = Fx::new();
    fx.connect_both("1", "2");
    fx.age("0.0.1", |_| true);
    let (code, ..) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0);
    let before = world(&fx.base());
    let backups_before = backups(&fx.base());
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(stdout.contains("up to date"), "{stdout}");
    assert_eq!(world(&fx.base()), before);
    assert_eq!(backups(&fx.base()), backups_before);
}

#[test]
fn a_terminal_rerun_with_nothing_to_do_asks_nothing() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    let before = world(&fx.base());
    let term = fx.session(&fx.root(), &["update"]);
    let (code, screen) = finish(term);
    assert_eq!(code, 0, "{screen}");
    assert!(!screen.contains("[y/N]"), "{screen}");
    assert!(screen.contains("up to date"), "{screen}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn a_version_only_change_updates_the_registry_and_nothing_else() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age_version_only("0.0.1");
    let backups_before = backups(&fx.base());
    let files_before: Vec<_> = world(&fx.base())
        .into_iter()
        .filter(|(p, _)| p != &fx.registry_file() && !backups_before.contains(p))
        .collect();
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    for r in fx.read_registry().installations {
        assert_eq!(r.installed_version, CURRENT);
    }
    let backed_up = backups(&fx.base());
    let files_after: Vec<_> = world(&fx.base())
        .into_iter()
        .filter(|(p, _)| p != &fx.registry_file() && !backed_up.contains(p))
        .collect();
    let changed: Vec<_> = files_after
        .iter()
        .zip(&files_before)
        .filter(|(a, b)| a != b)
        .map(|(a, _)| a.0.clone())
        .collect();
    assert!(
        files_after.len() == files_before.len() && changed.is_empty(),
        "changed: {changed:?}"
    );
    // Only the record changed: the only new backup is the registry's own.
    let new_backups: Vec<_> = backed_up
        .iter()
        .filter(|p| !backups_before.contains(p))
        .collect();
    assert!(
        new_backups.iter().all(|p| p.starts_with(fx.data())),
        "{new_backups:?}"
    );
    assert!(!stdout.contains("trust"), "{stdout}");
}

#[test]
fn a_changed_hook_is_replaced_and_the_trust_step_is_named() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age_hook(Agent::Claude);
    fx.age_version_only("0.0.1");
    let settings = fx.claude().join("settings.json");
    assert!(
        fs::read_to_string(&settings)
            .unwrap()
            .contains("an older hook")
    );
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(
        !fs::read_to_string(&settings)
            .unwrap()
            .contains("an older hook")
    );
    assert!(stdout.contains("trust"), "{stdout}");
    assert!(stdout.contains("/hooks"), "{stdout}");
}

#[test]
fn another_projects_records_and_files_are_never_touched() {
    let fx = Fx::new();
    // Project-scope installs belong to the root of project Demo. Update is
    // run from a second bound project, which has no records of its own.
    fx.connect_both("2", "2");
    fx.age("0.0.1", |_| true);
    let b = fx.other();
    let (code, ..) = fx.agboard(&["project", "create", "Second"], &b);
    assert_eq!(code, 0);
    let before = world(&fx.base());
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &b);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(stdout.contains("No managed integrations found"), "{stdout}");
    // Nothing was scanned or changed: files and the registry are as before.
    assert_eq!(world(&fx.base()), before);
    assert!(skill_is_old(&fx, Agent::Claude, true));
    let hook = record(&fx, Agent::Claude, Component::Hook, Scope::Project);
    assert_eq!(hook.installed_version, "0.0.1");
    assert_eq!(hook.bound_root.as_deref(), Some(fx.root().as_path()));
}

#[test]
fn from_an_unbound_folder_only_global_records_are_updated() {
    let fx = Fx::new();
    fx.connect_both("1", "2");
    fx.age("0.0.1", |_| true);
    let project_before = world(&fx.root());
    let unbound = fx.base().join("home");
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &unbound);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(stdout.contains("Global integrations only"), "{stdout}");
    assert!(!skill_is_old(&fx, Agent::Claude, false));
    // The Project-scope Hook records stay old.
    assert_eq!(world(&fx.root()), project_before);
    let hook = record(&fx, Agent::Claude, Component::Hook, Scope::Project);
    assert_eq!(hook.installed_version, "0.0.1");
}

#[test]
fn no_records_is_a_hint_and_zero_and_writes_nothing() {
    let fx = Fx::new();
    let before = world(&fx.base());
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(
        stdout.contains("No managed integrations found. Run agboard connect in a bound project."),
        "{stdout}"
    );
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn a_newer_record_is_never_downgraded() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    fx.edit_registry(|r| {
        for rec in &mut r.installations {
            rec.installed_version = "99.0.0".into();
        }
    });
    let before = world(&fx.base());
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 1, "{stdout}{stderr}");
    assert!(stderr.contains("downgrade"), "{stderr}");
    assert!(stderr.contains("agboard connect"), "{stderr}");
    assert_eq!(world(&fx.base()), before);
}

#[test]
fn a_broken_or_unknown_registry_is_reported_and_left_alone() {
    for text in ["{ not json", "{\"schemaVersion\":9,\"installations\":[]}"] {
        let fx = Fx::new();
        fx.connect_both("1", "1");
        fs::write(fx.registry_file(), text).unwrap();
        let before = world(&fx.base());
        let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
        assert_eq!(code, 1, "{stdout}{stderr}");
        assert!(stderr.contains("registry"), "{stderr}");
        assert_eq!(world(&fx.base()), before);
    }
}

#[test]
fn a_moved_install_location_is_refused() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    // The configuration now places Claude's files elsewhere.
    let moved = fx.base().join("claude-moved");
    fs::create_dir_all(&moved).unwrap();
    let mut cmd = fx.command(&fx.root());
    cmd.env("CLAUDE_CONFIG_DIR", &moved);
    let output = cmd
        .args(["update", "--yes"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Claude Code: not updated"), "{stderr}");
    assert!(!moved.join("skills").exists());
    // Codex was not affected by the move and is updated.
    assert!(!skill_is_old(&fx, Agent::Codex, false));
}

const PREVIEW: &str =
    "Public preview: this command may change. See the documentation for current limitations.";

#[test]
fn the_interactive_screen_starts_with_the_preview_line() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    let mut term = fx.session(&fx.root(), &["update"]);
    let seen = term.expect("[y/N]").unwrap();
    let screen = String::from_utf8_lossy(seen.as_bytes()).into_owned();
    assert!(screen.trim_start().starts_with(PREVIEW), "{screen}");
    term.send_line("n").unwrap();
    finish(term);
}

#[test]
fn yes_runs_and_refusals_do_not_print_the_preview_line() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(!format!("{stdout}{stderr}").contains(PREVIEW));
    let output = fx
        .command(&fx.root())
        .arg("update")
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
    let (code, stdout, stderr) = fx.agboard(&["update", "--json"], &fx.root());
    assert_eq!(code, 2);
    assert!(!format!("{stdout}{stderr}").contains(PREVIEW));
}

/// A second bound project "Second" at `other/`, with its own Project-scope
/// connect after the first project's.
fn two_projects() -> Fx {
    let fx = Fx::new();
    fx.connect_both("2", "2");
    let (code, ..) = fx.agboard(&["project", "create", "Second"], &fx.other());
    assert_eq!(code, 0);
    fx
}

fn project_records(fx: &Fx, root: &std::path::Path) -> usize {
    fx.read_registry()
        .installations
        .iter()
        .filter(|r| r.bound_root.as_deref() == Some(root))
        .count()
}

#[test]
fn connecting_in_a_second_project_keeps_the_first_projects_files_and_records() {
    let fx = two_projects();
    let first = world(&fx.root());
    fx.connect_both_at(&fx.other(), "2", "2");
    assert_eq!(world(&fx.root()), first, "the first project is untouched");
    assert_eq!(project_records(&fx, &fx.root()), 4);
    assert_eq!(project_records(&fx, &fx.other()), 4);

    // update run in the first project still finds and updates it
    fx.age("0.0.1", |r| {
        r.bound_root.as_deref() == Some(fx.root().as_path())
    });
    assert!(skill_is_old(&fx, Agent::Claude, true));
    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert!(!skill_is_old(&fx, Agent::Claude, true));
    assert_eq!(
        record(&fx, Agent::Claude, Component::Hook, Scope::Project).installed_version,
        CURRENT
    );
}

#[test]
fn a_global_hook_in_a_second_project_lists_and_moves_the_first_projects_hook() {
    let fx = two_projects();
    let first_hooks = [
        fx.root().join(".claude/settings.json"),
        fx.root().join(".codex/hooks.json"),
    ];
    let (code, screen) = fx.connect_screen_at(&fx.other(), "2", "1");
    assert_eq!(code, 0, "{screen}");
    for path in &first_hooks {
        assert!(screen.contains(path.to_str().unwrap()), "{screen}");
        assert!(
            !std::fs::read_to_string(path)
                .unwrap()
                .contains("agboard hook"),
            "{} still holds the Hook",
            path.display()
        );
    }
    let registry = fx.read_registry();
    let first_hook_records = registry
        .installations
        .iter()
        .filter(|r| r.bound_root.as_deref() == Some(fx.root().as_path()))
        .filter(|r| r.component == Component::Hook)
        .count();
    assert_eq!(first_hook_records, 0);
    // the first project's Skill stays
    assert!(fx.skill_dir(Agent::Claude, true).join("SKILL.md").is_file());
    assert_eq!(project_records(&fx, &fx.root()), 2);
}

#[test]
fn a_global_skill_in_a_second_project_warns_and_keeps_the_first_projects_skill() {
    let fx = two_projects();
    let (code, screen) = fx.connect_screen_at(&fx.other(), "1", "2");
    assert_eq!(code, 0, "{screen}");
    let first_skill = fx.skill_dir(Agent::Claude, true);
    assert!(first_skill.join("SKILL.md").is_file());
    assert!(screen.contains("Warning"), "{screen}");
    assert!(screen.contains(first_skill.to_str().unwrap()), "{screen}");
    let skills = fx
        .read_registry()
        .installations
        .into_iter()
        .filter(|r| r.component == Component::Skill && r.agent == Agent::Claude)
        .count();
    assert_eq!(skills, 2, "the first project's record and the Global one");
}

const THEIRS: &str = "{\"model\":\"edited-by-someone-else\"}\n";

#[test]
fn connect_stops_an_agent_whose_interrupted_run_met_an_outside_change() {
    let fx = Fx::new();
    let settings = fx.claude().join("settings.json");
    fs::write(&settings, "{\n  \"model\": \"sentinel\"\n}\n").unwrap();
    fx.interrupted_run(Agent::Claude);
    fs::write(&settings, THEIRS).unwrap();

    let (code, screen) = fx.connect_screen_at(&fx.root(), "1", "1");
    assert_eq!(code, 1, "{screen}");
    assert!(screen.contains(settings.to_str().unwrap()), "{screen}");
    assert!(screen.contains("settings.json.agboard-backup-"), "{screen}");
    assert!(
        screen.contains(fx.journal(Agent::Claude).to_str().unwrap()),
        "{screen}"
    );
    assert!(fx.journal(Agent::Claude).exists(), "the journal stays");
    assert_eq!(fs::read_to_string(&settings).unwrap(), THEIRS);
    // the other agent is unaffected
    assert!(fx.skill_dir(Agent::Codex, false).join("SKILL.md").is_file());
    assert!(!fx.skill_dir(Agent::Claude, false).join("SKILL.md").exists());
}

#[test]
fn update_stops_an_agent_whose_interrupted_run_met_an_outside_change() {
    let fx = Fx::new();
    fx.connect_both("1", "1");
    fx.age("0.0.1", |_| true);
    fx.age_hook(Agent::Claude);
    fx.interrupted_run(Agent::Claude);
    let settings = fx.claude().join("settings.json");
    fs::write(&settings, THEIRS).unwrap();

    let (code, stdout, stderr) = fx.agboard(&["update", "--yes"], &fx.root());
    assert_eq!(code, 1, "{stdout}{stderr}");
    assert!(stderr.contains(settings.to_str().unwrap()), "{stderr}");
    assert!(stderr.contains("settings.json.agboard-backup-"), "{stderr}");
    assert!(
        stderr.contains(fx.journal(Agent::Claude).to_str().unwrap()),
        "{stderr}"
    );
    assert!(fx.journal(Agent::Claude).exists(), "the journal stays");
    assert_eq!(fs::read_to_string(&settings).unwrap(), THEIRS);
    assert!(!skill_is_old(&fx, Agent::Codex, false), "Codex is updated");
}

#[test]
fn cancelling_after_a_recovery_says_the_earlier_run_was_undone() {
    let fx = Fx::new();
    fx.interrupted_run(Agent::Claude);
    let mut term = fx.session(&fx.root(), &["connect"]);
    let mut screen = String::new();
    for (prompt, answer) in [
        ("Select agents", "1"),
        ("Skill scope", "1"),
        ("Hook scope", "1"),
        ("[y/N]", "n"),
    ] {
        let seen = term.expect(prompt).unwrap();
        screen.push_str(&String::from_utf8_lossy(seen.as_bytes()));
        term.send_line(answer).unwrap();
    }
    let (code, rest) = finish(term);
    screen.push_str(&rest);
    assert_eq!(code, 0, "{screen}");
    assert!(screen.contains("undone"), "{screen}");
    assert!(
        !screen.contains("Cancelled. Nothing was changed."),
        "{screen}"
    );
    assert!(screen.contains("Cancelled."), "{screen}");
}
