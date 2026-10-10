//! Project rename and delete on the shared files (U1-9). Both run under the
//! catalog lock, so name uniqueness is checked against the latest names, and
//! a delete leaves every other project untouched.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Barrier, mpsc};
use std::time::Duration;

use agent_board::domain::{Actor, Assignee, NewCard, ProjectId};
use agent_board::error::SkanError;
use agent_board::file_store::FileStore;
use agent_board::file_store::lock::WriteLock;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    Fixture {
        _root: root,
        shared,
        store,
    }
}

impl Fixture {
    fn project_dir(&self, id: &ProjectId) -> PathBuf {
        self.shared.join("projects").join(id.as_str())
    }

    fn with_card(&self, name: &str) -> ProjectId {
        let id = self.store.create_project(name, now()).unwrap().id;
        self.store
            .create_card(
                &id,
                NewCard {
                    title: "card".into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                },
                now(),
            )
            .unwrap();
        id
    }
}

#[test]
fn renaming_keeps_the_id_and_the_cards_and_saves_the_trimmed_name() {
    let fx = fixture();
    let id = fx.with_card("Alpha");
    let dir = fx.project_dir(&id);
    let task_before = fs::read(dir.join("tasks/1/task.json")).unwrap();

    let renamed = fx.store.rename_project(&id, "  Gamma  ").unwrap();
    assert!(renamed.changed);
    assert_eq!(renamed.value.id, id);
    assert_eq!(renamed.value.name, "Gamma");

    let reopened = FileStore::open(&fx.shared);
    let names: Vec<String> = reopened
        .projects()
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, vec!["Gamma"]);
    let project_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
    assert_eq!(project_json["id"], id.as_str());
    assert_eq!(project_json["name"], "Gamma");
    assert_eq!(project_json["nextCardId"], 2);
    assert_eq!(
        fs::read(dir.join("tasks/1/task.json")).unwrap(),
        task_before
    );
}

#[test]
fn renaming_to_a_taken_name_is_refused_and_changes_nothing() {
    let fx = fixture();
    fx.store.create_project("Alpha", now()).unwrap();
    let beta = fx.store.create_project("Beta", now()).unwrap().id;
    let before = fs::read(fx.project_dir(&beta).join("project.json")).unwrap();

    let err = fx.store.rename_project(&beta, "Alpha").unwrap_err();
    assert!(
        matches!(err, SkanError::ProjectNameExists { .. }),
        "{err:?}"
    );
    assert_eq!(
        fs::read(fx.project_dir(&beta).join("project.json")).unwrap(),
        before
    );

    // Uniqueness is exact and case-sensitive, so a different case is allowed.
    assert!(fx.store.rename_project(&beta, "alpha").unwrap().changed);
}

#[test]
fn renaming_to_the_current_name_changes_nothing() {
    let fx = fixture();
    let id = fx.store.create_project("Alpha", now()).unwrap().id;
    let before = fs::read(fx.project_dir(&id).join("project.json")).unwrap();
    let same = fx.store.rename_project(&id, " Alpha ").unwrap();
    assert!(!same.changed);
    assert_eq!(
        fs::read(fx.project_dir(&id).join("project.json")).unwrap(),
        before
    );
}

#[test]
fn renaming_a_missing_project_is_project_not_found() {
    let fx = fixture();
    fx.store.create_project("Alpha", now()).unwrap();
    let missing: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
    assert!(matches!(
        fx.store.rename_project(&missing, "X"),
        Err(SkanError::ProjectNotFound { .. })
    ));
}

#[test]
fn two_concurrent_renames_to_one_name_leave_exactly_one_success() {
    let fx = fixture();
    let a = fx.store.create_project("A", now()).unwrap().id;
    let b = fx.store.create_project("B", now()).unwrap().id;
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [a.clone(), b.clone()]
        .into_iter()
        .map(|id| {
            let shared = fx.shared.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let store = FileStore::open(&shared);
                barrier.wait();
                store.rename_project(&id, "Same")
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let succeeded = results.iter().filter(|r| r.is_ok()).count();
    let refused = results
        .iter()
        .filter(|r| matches!(r, Err(SkanError::ProjectNameExists { .. })))
        .count();
    assert_eq!(succeeded, 1, "{results:?}");
    assert_eq!(refused, 1, "{results:?}");

    let projects = fx.store.projects().unwrap();
    let same: Vec<_> = projects.iter().filter(|p| p.name == "Same").collect();
    assert_eq!(same.len(), 1);
    let other = projects.iter().find(|p| p.name != "Same").unwrap();
    assert!(other.id == a || other.id == b);
    assert_ne!(same[0].id, other.id);
}

#[test]
fn deleting_removes_only_that_project_and_its_cards() {
    let fx = fixture();
    let doomed = fx.with_card("Doomed");
    let kept = fx.with_card("Kept");
    let kept_dir = fx.project_dir(&kept);
    let kept_project = fs::read(kept_dir.join("project.json")).unwrap();
    let kept_task = fs::read(kept_dir.join("tasks/1/task.json")).unwrap();

    fx.store.delete_project(&doomed).unwrap();

    assert!(!fx.project_dir(&doomed).exists());
    let projects = fx.store.projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, kept);
    assert_eq!(
        fs::read(kept_dir.join("project.json")).unwrap(),
        kept_project
    );
    assert_eq!(
        fs::read(kept_dir.join("tasks/1/task.json")).unwrap(),
        kept_task
    );
    let snapshot = fx.store.snapshot(&kept).unwrap();
    assert_eq!(snapshot.cards.len(), 1);
    assert!(snapshot.problems.is_empty());
    // No leftover of the deleted folder remains in the projects folder.
    let leftovers: Vec<String> = fs::read_dir(fx.shared.join("projects"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with('.'))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn deleting_a_missing_project_is_project_not_found() {
    let fx = fixture();
    fx.store.create_project("Alpha", now()).unwrap();
    let missing: ProjectId = "0123456789abcdef0123456789abcdef".parse().unwrap();
    assert!(matches!(
        fx.store.delete_project(&missing),
        Err(SkanError::ProjectNotFound { .. })
    ));
}

#[test]
fn a_deleted_name_can_be_used_again_by_a_new_project() {
    let fx = fixture();
    let old = fx.store.create_project("Alpha", now()).unwrap().id;
    fx.store.delete_project(&old).unwrap();
    let new = fx.store.create_project("Alpha", now()).unwrap().id;
    assert_ne!(old, new);
    assert_eq!(fx.store.projects().unwrap().len(), 1);
}

#[test]
fn renames_and_deletes_wait_for_the_catalog_lock() {
    let fx = fixture();
    let id = fx.store.create_project("Alpha", now()).unwrap().id;
    let catalog = fx.shared.join(".internal").join("catalog.lock");
    let held = WriteLock::acquire(&catalog).unwrap();

    let (tx, rx) = mpsc::channel();
    let shared = fx.shared.clone();
    let worker = std::thread::spawn(move || {
        let store = FileStore::open(&shared);
        let renamed = store.rename_project(&id, "Renamed");
        tx.send(renamed.is_ok()).unwrap();
    });
    assert!(
        rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "a rename must wait while the catalog lock is held"
    );
    drop(held);
    assert!(rx.recv_timeout(Duration::from_secs(5)).unwrap());
    worker.join().unwrap();
}
