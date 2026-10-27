//! Focused tests for the transaction journal, rollback, and recovery:
//! injected failures at the backup, the rename, the registry commit and the
//! recovery itself, a process that dies mid-run, and changes made by someone
//! else while a run is in progress. Every case runs in a temporary directory
//! with its own AGBOARD_HOME, CODEX_HOME, and CLAUDE_CONFIG_DIR.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use agent_board::integrations::apply::{
    AgentOutcome, ApplyOptions, Phase, Status, Step, StepAction, apply_agent,
};
use agent_board::integrations::assets::{bundle, sha256_hex, skill_manifest_hash};
use agent_board::integrations::paths::{PathEnv, placement, registry_path, resolve_targets};
use agent_board::integrations::plan::{AgentPlan, PlanInput, plan_agent};
use agent_board::integrations::recovery::{is_pending, recover_pending};
use agent_board::integrations::registry::{InstallationRecord, ManagedFile, Registry};
use agent_board::integrations::{Agent, Component, Scope};

struct Fx {
    _tmp: tempfile::TempDir,
    base: PathBuf,
    env: PathEnv,
    root: PathBuf,
}

fn fixture() -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().canonicalize().unwrap();
    for dir in ["home", "data", "codex", "claude", "project"] {
        fs::create_dir_all(base.join(dir)).unwrap();
    }
    let env = PathEnv {
        agboard_home: Some(OsString::from(base.join("data"))),
        home: Some(base.join("home")),
        codex_home: Some(OsString::from(base.join("codex"))),
        claude_config_dir: Some(OsString::from(base.join("claude"))),
    };
    let root = base.join("project");
    Fx {
        _tmp: tmp,
        base,
        env,
        root,
    }
}

fn plan(fx: &Fx, skill: Scope, hook: Scope) -> AgentPlan {
    let registry = Registry::read(&registry_path(&fx.env).unwrap())
        .unwrap()
        .unwrap_or_default();
    let targets = resolve_targets(&fx.env, Agent::Claude, skill, hook, Some(&fx.root)).unwrap();
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

fn run(fx: &Fx, observer: Option<&dyn Fn(&Step) -> StepAction>) -> AgentOutcome {
    apply_agent(
        &fx.env,
        &plan(fx, Scope::Global, Scope::Global),
        &ApplyOptions { observer },
    )
}

fn paths(fx: &Fx) -> (PathBuf, PathBuf, PathBuf) {
    let skill = placement(
        &fx.env,
        Agent::Claude,
        Component::Skill,
        Scope::Global,
        None,
    )
    .unwrap();
    let settings = placement(&fx.env, Agent::Claude, Component::Hook, Scope::Global, None).unwrap();
    (skill, settings, registry_path(&fx.env).unwrap())
}

fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_none_or(|ext| ext != "lock") {
                out.insert(path.clone(), fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, &mut out);
    out
}

/// A user settings file that already exists, so there is an original to back up.
const ORIGINAL: &str = "{\n  \"model\": \"sentinel\"\n}\n";

fn with_settings(fx: &Fx) -> (PathBuf, PathBuf) {
    let (skill, settings, _) = paths(fx);
    fs::write(&settings, ORIGINAL).unwrap();
    (skill, settings)
}

fn leftovers(fx: &Fx) -> Vec<PathBuf> {
    snapshot(&fx.base)
        .into_keys()
        .filter(|p| {
            let name = p.to_string_lossy();
            name.contains("agboard-backup")
                || name.contains("agboard-stage")
                || name.contains("integrations-journal")
        })
        .collect()
}

fn fail_at(phase: Phase, index: usize) -> impl Fn(&Step) -> StepAction {
    move |step: &Step| {
        if step.phase == phase && step.index == index {
            StepAction::Fail(format!("injected failure at {phase:?} {index}"))
        } else {
            StepAction::Continue
        }
    }
}

#[test]
fn a_failure_at_the_backup_restores_everything() {
    let fx = fixture();
    let (skill, settings) = with_settings(&fx);
    let before = snapshot(&fx.base);
    let observer = fail_at(Phase::Backup, 1);
    let outcome = run(&fx, Some(&observer));
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.rollback.as_ref().unwrap().is_clean());
    assert_eq!(
        snapshot(&fx.base),
        before,
        "the first target was written and is back as it was"
    );
    assert_eq!(fs::read_to_string(&settings).unwrap(), ORIGINAL);
    assert!(!skill.exists());
    assert!(leftovers(&fx).is_empty(), "{:?}", leftovers(&fx));
}

#[test]
fn a_failure_at_the_rename_restores_everything_including_the_skill_tree() {
    let fx = fixture();
    let (skill, settings) = with_settings(&fx);
    let before = snapshot(&fx.base);
    // ops: settings file (0), Skill tree (1), registry (2)
    let observer = fail_at(Phase::Rename, 1);
    let outcome = run(&fx, Some(&observer));
    assert_eq!(outcome.status, Status::Failed);
    assert_eq!(fs::read_to_string(&settings).unwrap(), ORIGINAL);
    assert!(!skill.exists());
    assert_eq!(snapshot(&fx.base), before);
    assert!(leftovers(&fx).is_empty());
}

#[test]
fn a_failure_at_the_registry_commit_restores_everything() {
    let fx = fixture();
    let (skill, settings) = with_settings(&fx);
    let before = snapshot(&fx.base);
    let observer = fail_at(Phase::Registry, 2);
    let outcome = run(&fx, Some(&observer));
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.message.as_deref().unwrap().contains("restored"));
    assert_eq!(fs::read_to_string(&settings).unwrap(), ORIGINAL);
    assert!(
        !skill.exists(),
        "the Skill that was already in place is removed again"
    );
    assert!(
        !paths(&fx).2.exists(),
        "no registry without the files it describes"
    );
    assert_eq!(snapshot(&fx.base), before);
    assert!(leftovers(&fx).is_empty());
    // the same run succeeds once the fault is gone
    assert_eq!(run(&fx, None).status, Status::Applied);
}

/// Installs an older Skill (one file) and records it, as an earlier version would have.
fn install_old_skill(fx: &Fx) -> PathBuf {
    let (skill, _, registry) = paths(fx);
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "old skill").unwrap();
    let files = vec![ManagedFile {
        path: "SKILL.md".into(),
        sha256: sha256_hex(b"old skill"),
    }];
    let record = InstallationRecord {
        agent: Agent::Claude,
        component: Component::Skill,
        scope: Scope::Global,
        project_id: None,
        bound_root: None,
        configured_path: skill.clone(),
        resolved_path: skill.clone(),
        installed_version: "0.0.1".into(),
        managed_hash: skill_manifest_hash(&files),
        managed_entries: Vec::new(),
        files,
    };
    fs::write(
        &registry,
        Registry {
            installations: vec![record],
        }
        .to_json(),
    )
    .unwrap();
    skill
}

#[test]
fn an_update_keeps_the_old_skill_as_a_backup_and_a_failure_puts_it_back() {
    let fx = fixture();
    let skill = install_old_skill(&fx);
    let before = snapshot(&fx.base);
    let observer = fail_at(Phase::Registry, 2);
    let outcome = run(&fx, Some(&observer));
    assert_eq!(outcome.status, Status::Failed, "{outcome:?}");
    assert_eq!(
        fs::read_to_string(skill.join("SKILL.md")).unwrap(),
        "old skill"
    );
    assert_eq!(fs::read_dir(&skill).unwrap().count(), 1);
    assert_eq!(snapshot(&fx.base), before);

    let outcome = run(&fx, None);
    assert_eq!(outcome.status, Status::Applied, "{outcome:?}");
    assert!(
        skill.join("references").is_dir(),
        "the new Skill is in place"
    );
    let backup = outcome
        .backups
        .iter()
        .find(|b| b.join("SKILL.md").is_file())
        .expect("the old directory is the backup");
    assert_eq!(
        fs::read_to_string(backup.join("SKILL.md")).unwrap(),
        "old skill"
    );
}

/// Folders of `root` that hold a SKILL.md: the ones an agent would load.
fn loaded_skills(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .map(|e| e.unwrap().path())
        .filter(|p| p.join("SKILL.md").is_file())
        .collect()
}

#[test]
fn a_skill_update_leaves_one_skill_in_the_skills_root_and_the_backup_outside() {
    let fx = fixture();
    let skill = install_old_skill(&fx);
    let outcome = run(&fx, None);
    assert_eq!(outcome.status, Status::Applied, "{outcome:?}");
    let root = skill.parent().unwrap();
    assert_eq!(
        loaded_skills(root),
        vec![skill.clone()],
        "{:?}",
        fs::read_dir(root).unwrap().collect::<Vec<_>>()
    );
    assert_eq!(
        fs::read_dir(root).unwrap().count(),
        1,
        "nothing else in the skills root"
    );
    let hidden = fx.base.join("claude/.agboard-backups");
    let backup = outcome
        .backups
        .iter()
        .find(|b| b.join("SKILL.md").is_file())
        .expect("the old Skill is kept");
    assert!(backup.starts_with(&hidden), "{}", backup.display());
    assert_eq!(
        fs::read_to_string(backup.join("SKILL.md")).unwrap(),
        "old skill"
    );
}

#[test]
fn a_run_that_dies_is_detected_and_undone_by_the_next_run() {
    let fx = fixture();
    let (skill, settings) = with_settings(&fx);
    let before = snapshot(&fx.base);
    let crash = |step: &Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    let stale = plan(&fx, Scope::Global, Scope::Global);
    let outcome = apply_agent(
        &fx.env,
        &stale,
        &ApplyOptions {
            observer: Some(&crash),
        },
    );
    assert_eq!(outcome.status, Status::Interrupted);
    assert!(is_pending(&fx.env, Agent::Claude).unwrap());
    assert_ne!(
        fs::read_to_string(&settings).unwrap(),
        ORIGINAL,
        "the dead run left its writes"
    );
    assert!(skill.join("SKILL.md").is_file());

    // a run that was planned earlier refuses to start on top of the unfinished one
    let again = apply_agent(&fx.env, &stale, &ApplyOptions::default());
    assert_eq!(again.status, Status::Failed);
    assert!(again.message.as_deref().unwrap().contains("did not finish"));

    let report = recover_pending(&fx.env, Agent::Claude, None)
        .unwrap()
        .expect("pending");
    assert!(report.is_clean(), "{report:?}");
    assert!(!is_pending(&fx.env, Agent::Claude).unwrap());
    assert_eq!(snapshot(&fx.base), before);
    assert!(leftovers(&fx).is_empty());
    assert_eq!(run(&fx, None).status, Status::Applied);
    assert!(
        recover_pending(&fx.env, Agent::Claude, None)
            .unwrap()
            .is_none()
    );
}

#[test]
fn a_run_that_dies_between_the_two_renames_of_a_skill_update_is_recovered() {
    let fx = fixture();
    let skill = install_old_skill(&fx);
    let crash = |step: &Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    assert_eq!(run(&fx, Some(&crash)).status, Status::Interrupted);
    // simulate the process dying after the old directory moved away but before the new one arrived
    let journal: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(fx.base.join("data/integrations-journal-claude.json")).unwrap(),
    )
    .unwrap();
    let op = journal["ops"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["kind"] == "tree")
        .unwrap();
    fs::remove_dir_all(&skill).unwrap();
    let backup = PathBuf::from(op["backup"].as_str().expect("a backup is journaled"));
    assert!(
        backup.starts_with(fx.base.join("claude/.agboard-backups")),
        "the Skill backup is outside the skills root: {}",
        backup.display()
    );
    assert!(backup.join("SKILL.md").is_file());
    let report = recover_pending(&fx.env, Agent::Claude, None)
        .unwrap()
        .unwrap();
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(
        fs::read_to_string(skill.join("SKILL.md")).unwrap(),
        "old skill"
    );
}

#[test]
fn a_failure_during_recovery_keeps_the_journal_and_a_later_recovery_finishes() {
    let fx = fixture();
    let (_, settings) = with_settings(&fx);
    let before = snapshot(&fx.base);
    let crash = |step: &Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    assert_eq!(run(&fx, Some(&crash)).status, Status::Interrupted);
    let fault = fail_at(Phase::Recovery, 0);
    let report = recover_pending(&fx.env, Agent::Claude, Some(&fault))
        .unwrap()
        .unwrap();
    assert!(!report.is_clean());
    assert_eq!(report.stuck.len(), 1);
    assert_eq!(
        report.stuck[0].0, settings,
        "the report names the path and the reason"
    );
    assert!(
        is_pending(&fx.env, Agent::Claude).unwrap(),
        "the journal stays so recovery can be retried"
    );

    let report = recover_pending(&fx.env, Agent::Claude, None)
        .unwrap()
        .unwrap();
    assert!(report.is_clean(), "{report:?}");
    assert_eq!(snapshot(&fx.base), before);
}

#[test]
fn a_change_by_someone_else_before_a_target_is_replaced_is_never_overwritten() {
    let fx = fixture();
    let (skill, settings) = with_settings(&fx);
    // After the settings file is written, someone edits the Skill directory's
    // parent state: here, a file appears where the Skill will go.
    let cell = RefCell::new(0);
    let meddle = |step: &Step| {
        if step.phase == Phase::Backup && step.index == 1 {
            *cell.borrow_mut() += 1;
            fs::create_dir_all(&skill).unwrap();
            fs::write(skill.join("theirs.md"), "theirs").unwrap();
        }
        StepAction::Continue
    };
    let outcome = run(&fx, Some(&meddle));
    assert_eq!(outcome.status, Status::Failed);
    assert!(
        outcome
            .message
            .as_deref()
            .unwrap()
            .contains("changed while the run was in progress")
    );
    assert_eq!(
        fs::read_to_string(skill.join("theirs.md")).unwrap(),
        "theirs"
    );
    assert!(!skill.join("SKILL.md").exists());
    assert_eq!(
        fs::read_to_string(&settings).unwrap(),
        ORIGINAL,
        "the earlier write is undone"
    );
    assert_eq!(*cell.borrow(), 1);
}

#[test]
fn a_change_made_after_our_write_is_left_alone_by_the_rollback() {
    let fx = fixture();
    let (_, settings) = with_settings(&fx);
    let edited = "{\"model\":\"edited-by-someone-else\"}";
    let meddle = |step: &Step| {
        if step.phase == Phase::Registry {
            fs::write(&settings, edited).unwrap();
            return StepAction::Fail("registry unavailable".into());
        }
        StepAction::Continue
    };
    let outcome = run(&fx, Some(&meddle));
    assert_eq!(outcome.status, Status::Failed);
    let report = outcome.rollback.clone().unwrap();
    assert!(
        report.is_clean(),
        "an external change is not a stuck rollback"
    );
    assert_eq!(report.external.len(), 1);
    assert_eq!(report.external[0].0, settings);
    let backup = report.external[0].1.clone().expect("the backup is named");
    assert_eq!(
        fs::read_to_string(&backup).unwrap(),
        ORIGINAL,
        "the original is safe in the backup"
    );
    assert_eq!(
        fs::read_to_string(&settings).unwrap(),
        edited,
        "their edit is not overwritten"
    );
    assert!(!is_pending(&fx.env, Agent::Claude).unwrap());

    // The failure text says what was left and where the originals are.
    let message = outcome.message.as_deref().unwrap();
    assert!(
        !message.contains("Everything this run changed"),
        "{message}"
    );
    assert!(message.contains("someone else"), "{message}");
    let (_, errors) = agent_board::integrations::update_report::results(
        std::slice::from_ref(&AgentOutcome {
            rollback: Some(report.clone()),
            ..outcome.clone()
        }),
        &[],
        1,
    );
    assert!(errors.contains(backup.to_str().unwrap()), "{errors}");
    let mut stuck = report;
    stuck
        .stuck
        .push((settings.clone(), "no".into(), Some(backup.clone())));
    let (_, errors) = agent_board::integrations::update_report::results(
        &[AgentOutcome {
            rollback: Some(stuck),
            ..outcome
        }],
        &[],
        1,
    );
    assert!(
        errors.matches(backup.to_str().unwrap()).count() >= 2,
        "{errors}"
    );
}

#[test]
fn recovery_keeps_the_journal_when_someone_else_changed_a_file() {
    let fx = fixture();
    let (_, settings) = with_settings(&fx);
    let crash = |step: &Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    assert_eq!(run(&fx, Some(&crash)).status, Status::Interrupted);
    let edited = "{\"model\":\"edited-by-someone-else\"}";
    fs::write(&settings, edited).unwrap();

    for _ in 0..2 {
        let report = recover_pending(&fx.env, Agent::Claude, None)
            .unwrap()
            .expect("pending");
        assert!(!report.is_clean(), "{report:?}");
        assert_eq!(report.external.len(), 1);
        assert_eq!(report.external[0].0, settings);
        let backup = report.external[0].1.as_ref().expect("the backup is named");
        assert_eq!(fs::read_to_string(backup).unwrap(), ORIGINAL);
        assert!(report.journal.as_ref().unwrap().is_file());
        assert!(is_pending(&fx.env, Agent::Claude).unwrap());
        assert_eq!(fs::read_to_string(&settings).unwrap(), edited);
    }
    let text = agent_board::integrations::report::recovery(
        Agent::Claude,
        &recover_pending(&fx.env, Agent::Claude, None)
            .unwrap()
            .unwrap(),
    );
    assert!(text.contains("could not be undone safely"), "{text}");
    assert!(text.contains("integrations-journal-claude.json"), "{text}");
}

#[test]
fn recovery_takes_the_agent_lock_before_it_reads_the_journal() {
    let fx = fixture();
    with_settings(&fx);
    let crash = |step: &Step| {
        if step.phase == Phase::Registry {
            StepAction::Crash
        } else {
            StepAction::Continue
        }
    };
    assert_eq!(run(&fx, Some(&crash)).status, Status::Interrupted);
    let held = agent_board::integrations::journal::AgentLock::acquire(
        &fx.base.join("data"),
        Agent::Claude,
    )
    .unwrap();
    let error = recover_pending(&fx.env, Agent::Claude, None).unwrap_err();
    assert!(error.to_string().contains("another run"), "{error}");
    drop(held);
    assert!(
        recover_pending(&fx.env, Agent::Claude, None)
            .unwrap()
            .is_some()
    );
}

#[test]
fn two_runs_for_one_agent_do_not_overlap() {
    let fx = fixture();
    with_settings(&fx);
    let nested = RefCell::new(None);
    let probe = |step: &Step| {
        if step.phase == Phase::Backup && step.index == 0 {
            *nested.borrow_mut() = Some(run(&fx, None));
        }
        StepAction::Continue
    };
    let outer = run(&fx, Some(&probe));
    assert_eq!(outer.status, Status::Applied);
    let inner = nested.borrow_mut().take().unwrap();
    assert_eq!(inner.status, Status::Failed);
    assert!(inner.message.as_deref().unwrap().contains("another run"));
}
