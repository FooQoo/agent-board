//! The Summary projection and the facets of a change (data-layer): each test changes the shared
//! files the way a command, the board or an editor does, reloads the index, and checks the
//! change set and the versions the index reports.

mod common;

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId};
use agent_board::file_store::FileStore;
use agent_board::file_store::TaskTextParts;
use agent_board::file_store::frontmatter::AcceptanceItem;
use agent_board::file_store::index::{ProjectEntry, ProjectIndex};
use agent_board::file_store::model::{EpicUpdate, NewEpic};
use agent_board::file_store::projection::{ChangeSet, Facet, Projection, Resource, ResourceId};
use agent_board::file_store::validate::EpicId;
use chrono::{DateTime, TimeZone, Utc};

fn at(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 10, 1, 0, 0).unwrap()
        + chrono::Duration::minutes(i64::from(minute))
}

struct Fx {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
    index: ProjectIndex,
}

impl Fx {
    /// A project with task 1 (in Todo) and an epic `ALPHA`, the index read once. The first read
    /// is the baseline: its changes are dropped.
    fn new() -> Fx {
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join("shared");
        let store = FileStore::open(&shared);
        let project = store.create_project("Alpha", at(0)).unwrap().id;
        store
            .create_epic(
                &project,
                NewEpic {
                    id: "ALPHA".into(),
                    name: "Alpha epic".into(),
                    color: Some("#336699".into()),
                    is_draft: false,
                    document: None,
                },
                at(1),
            )
            .unwrap();
        store
            .create_task(
                &project,
                NewTask {
                    title: "First".into(),
                    description: common::BODY.into(),
                    assignee: Assignee::Ai,
                    actor: Actor::Human,
                    is_draft: false,
                },
                at(2),
            )
            .unwrap();
        let mut fx = Fx {
            _root: root,
            shared,
            store,
            project,
            index: ProjectIndex::default(),
        };
        fx.index.reload_all(&fx.shared).unwrap();
        fx.index.take_changes();
        fx
    }

    fn reload(&mut self) -> Vec<ChangeSet> {
        self.index.reload_project(&self.shared, &self.project);
        self.index.take_changes()
    }

    fn projection(&self) -> std::sync::Arc<Projection> {
        self.index
            .entry(&self.project)
            .and_then(ProjectEntry::projection)
            .cloned()
            .expect("a projection")
    }

    fn task_dir(&self, id: i64) -> PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("tasks")
            .join(id.to_string())
    }

    fn epic_dir(&self, id: &str) -> PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("epics")
            .join(id)
    }

    fn doing(&self) {
        self.store
            .move_work_task(
                &self.project,
                1,
                Column::Doing,
                ChangeContext {
                    actor: Actor::Ai,
                    reason: "Start.".into(),
                },
                at(10),
            )
            .unwrap();
    }
}

/// The facets reported for one resource, if it is in the change sets.
fn facets_of(sets: &[ChangeSet], resource: Resource, id: ResourceId) -> Option<Vec<Facet>> {
    sets.iter()
        .flat_map(|set| &set.changes)
        .find(|change| change.resource == resource && change.id == id)
        .map(|change| change.facets.clone())
}

fn task_facets(sets: &[ChangeSet], id: i64) -> Option<Vec<Facet>> {
    facets_of(sets, Resource::Task, ResourceId::Task(id))
}

fn epic_facets(sets: &[ChangeSet], id: &str) -> Option<Vec<Facet>> {
    facets_of(sets, Resource::Epic, ResourceId::Named(id.into()))
}

#[test]
fn projection_a_status_change_is_summary_and_history_and_leaves_the_document_version() {
    let mut fx = Fx::new();
    let before = fx.projection().tasks[0].clone();
    fx.doing();
    let sets = fx.reload();
    assert_eq!(
        task_facets(&sets, 1),
        Some(vec![Facet::Summary, Facet::History])
    );
    let after = fx.projection().tasks[0].clone();
    assert_eq!(after.document_version, before.document_version);
    assert_ne!(after.history_version, before.history_version);
    assert_ne!(after.summary_hash, before.summary_hash);
    assert_eq!(after.document_version.len(), 32);
}

#[test]
fn projection_a_body_change_is_summary_and_document() {
    let mut fx = Fx::new();
    let before = fx.projection().tasks[0].clone();
    let body = common::BODY.replace("Details", "Other details");
    fx.store
        .edit_task_parts(
            &fx.project,
            1,
            None,
            TaskTextParts {
                body: Some(&body),
                acceptance: None,
            },
            at(11),
        )
        .unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("task 1 changed");
    assert!(facets.contains(&Facet::Summary), "{facets:?}");
    assert!(facets.contains(&Facet::Document), "{facets:?}");
    let after = fx.projection().tasks[0].clone();
    assert_ne!(after.document_version, before.document_version);
    assert_eq!(
        facets.contains(&Facet::History),
        after.history_version != before.history_version
    );
}

#[test]
fn projection_an_acceptance_change_is_summary_and_document() {
    let mut fx = Fx::new();
    let before = fx.projection().tasks[0].clone();
    let items = vec![AcceptanceItem {
        id: "AC-1".into(),
        text: "Done differently".into(),
        done: true,
    }];
    fx.store
        .edit_task_parts(
            &fx.project,
            1,
            None,
            TaskTextParts {
                body: None,
                acceptance: Some(&items),
            },
            at(11),
        )
        .unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("task 1 changed");
    assert!(facets.contains(&Facet::Summary), "{facets:?}");
    assert!(facets.contains(&Facet::Document), "{facets:?}");
    let after = fx.projection().tasks[0].clone();
    assert_eq!(after.fields.acceptance_done, 1);
    assert_eq!(after.fields.acceptance_total, 1);
    assert_ne!(after.document_version, before.document_version);
}

#[test]
fn projection_a_history_entry_alone_is_history_and_leaves_the_document_version() {
    let mut fx = Fx::new();
    let before = fx.projection().tasks[0].clone();
    fx.store
        .add_history(&fx.project, 1, Some("Progress note."), at(12))
        .unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("task 1 changed");
    assert!(facets.contains(&Facet::History), "{facets:?}");
    assert!(!facets.contains(&Facet::Document), "{facets:?}");
    let after = fx.projection().tasks[0].clone();
    assert_eq!(after.document_version, before.document_version);
    assert_ne!(after.history_version, before.history_version);
}

#[test]
fn projection_an_epic_document_change_is_document_and_a_name_or_color_change_is_summary() {
    let mut fx = Fx::new();
    let id = EpicId::normalize("ALPHA").unwrap();
    let before = fx.projection().epics[0].clone();

    fx.store
        .update_epic(
            &fx.project,
            &id,
            EpicUpdate {
                document: Some("# Alpha\n\nA new document.\n".into()),
                ..EpicUpdate::default()
            },
            at(20),
        )
        .unwrap();
    let sets = fx.reload();
    assert_eq!(epic_facets(&sets, "ALPHA"), Some(vec![Facet::Document]));
    let mid = fx.projection().epics[0].clone();
    assert_ne!(mid.document_version, before.document_version);
    assert_eq!(mid.summary_hash, before.summary_hash);

    fx.store
        .update_epic(
            &fx.project,
            &id,
            EpicUpdate {
                name: Some("Renamed".into()),
                color: Some("#112233".into()),
                ..EpicUpdate::default()
            },
            at(21),
        )
        .unwrap();
    let sets = fx.reload();
    assert_eq!(epic_facets(&sets, "ALPHA"), Some(vec![Facet::Summary]));
    let after = fx.projection().epics[0].clone();
    assert_eq!(after.document_version, mid.document_version);
    assert_ne!(after.summary_hash, mid.summary_hash);
}

#[test]
fn projection_archive_and_restore_are_summary_and_delete_is_deleted() {
    let mut fx = Fx::new();
    // Archiving and restoring record a history entry, so the history facet is true as well;
    // what matters is that they are a summary change, not a deletion and not a document change.
    fx.store.archive_task(&fx.project, 1, at(30)).unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("archived");
    assert!(facets.contains(&Facet::Summary), "{facets:?}");
    assert!(!facets.contains(&Facet::Deleted), "{facets:?}");
    assert!(!facets.contains(&Facet::Document), "{facets:?}");

    fx.store.restore_task(&fx.project, 1, at(31)).unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("restored");
    assert!(facets.contains(&Facet::Summary), "{facets:?}");
    assert!(!facets.contains(&Facet::Deleted), "{facets:?}");
    assert!(!facets.contains(&Facet::Document), "{facets:?}");

    fx.store.delete_task(&fx.project, 1).unwrap();
    let sets = fx.reload();
    assert_eq!(task_facets(&sets, 1), Some(vec![Facet::Deleted]));
    assert!(fx.projection().tasks.is_empty());
}

#[test]
fn projection_a_direct_edit_gets_the_same_classification_from_the_content() {
    let mut fx = Fx::new();
    // A title edited in task.json by hand is a summary change only.
    let json_path = fx.task_dir(1).join("task.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&json_path).unwrap()).unwrap();
    value["title"] = "Edited by hand".into();
    fs::write(&json_path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    let sets = fx.reload();
    assert_eq!(task_facets(&sets, 1), Some(vec![Facet::Summary]));

    // A body edited in TASK.md by hand is a document change (and the file's time moves).
    let md_path = fx.task_dir(1).join("TASK.md");
    let text = fs::read_to_string(&md_path).unwrap();
    fs::write(&md_path, text.replace("Details", "Hand-written details")).unwrap();
    let sets = fx.reload();
    let facets = task_facets(&sets, 1).expect("task 1 changed");
    assert!(facets.contains(&Facet::Document), "{facets:?}");
    assert!(!facets.contains(&Facet::History), "{facets:?}");

    // The same bytes again change nothing.
    fs::write(&md_path, fs::read_to_string(&md_path).unwrap()).unwrap();
    assert!(fx.reload().is_empty());
}

#[test]
fn projection_a_broken_file_changes_every_facet_of_its_resource() {
    let mut fx = Fx::new();
    let all = vec![Facet::Summary, Facet::Document, Facet::History];

    // A TASK.md whose frontmatter cannot be read.
    let md_path = fx.task_dir(1).join("TASK.md");
    let good = fs::read_to_string(&md_path).unwrap();
    fs::write(&md_path, "---\nacceptance: [unclosed\n---\n\nbroken\n").unwrap();
    let sets = fx.reload();
    assert_eq!(task_facets(&sets, 1), Some(all.clone()));
    assert!(!fx.projection().problems.is_empty());

    // Fixing it changes every facet again.
    fs::write(&md_path, &good).unwrap();
    let sets = fx.reload();
    assert_eq!(task_facets(&sets, 1), Some(all.clone()));

    // A task.json that is not JSON leaves the task out of the snapshot: still all facets.
    let json_path = fx.task_dir(1).join("task.json");
    let good_json = fs::read(&json_path).unwrap();
    fs::write(&json_path, "{not json").unwrap();
    let sets = fx.reload();
    assert_eq!(task_facets(&sets, 1), Some(all.clone()));
    // The same broken bytes again change nothing; other bytes do.
    fs::write(&json_path, "{not json either").unwrap();
    assert_eq!(task_facets(&fx.reload(), 1), Some(all.clone()));
    fs::write(&json_path, good_json).unwrap();
    assert_eq!(task_facets(&fx.reload(), 1), Some(all));

    // A broken epic.json changes both facets of the epic.
    let epic_json = fx.epic_dir("ALPHA").join("epic.json");
    fs::write(&epic_json, "{broken").unwrap();
    let sets = fx.reload();
    assert_eq!(
        epic_facets(&sets, "ALPHA"),
        Some(vec![Facet::Summary, Facet::Document])
    );
}

#[test]
fn projection_the_same_content_has_the_same_versions_after_a_restart() {
    let mut fx = Fx::new();
    fx.doing();
    fx.store
        .add_history(&fx.project, 1, Some("Note."), at(40))
        .unwrap();
    fx.reload();
    let first = fx.projection();
    assert_eq!(first.version.len(), 32);

    // A new index over the same files: a restart.
    let mut restarted = ProjectIndex::default();
    restarted.reload_all(&fx.shared).unwrap();
    let second = restarted
        .entry(&fx.project)
        .and_then(ProjectEntry::projection)
        .cloned()
        .unwrap();
    assert_eq!(*second, *first);
    assert_eq!(second.version, first.version);
    assert_eq!(
        second.tasks[0].document_version,
        first.tasks[0].document_version
    );
    assert_eq!(
        second.tasks[0].history_version,
        first.tasks[0].history_version
    );
    assert_eq!(
        second.epics[0].document_version,
        first.epics[0].document_version
    );
    // The first read of a started index is a baseline, and reading it again changes nothing.
    restarted.take_changes();
    restarted.reload_all(&fx.shared).unwrap();
    assert!(restarted.take_changes().is_empty());
}

#[test]
fn projection_the_summary_version_follows_what_the_summary_shows() {
    let mut fx = Fx::new();
    let first = fx.projection().version.clone();
    fx.doing();
    fx.reload();
    let second = fx.projection().version.clone();
    assert_ne!(first, second);
    // An epic's progress is part of the Summary.
    fx.store
        .set_task_epic(
            &fx.project,
            1,
            Some(&EpicId::normalize("ALPHA").unwrap()),
            Actor::Human,
            at(50),
        )
        .unwrap();
    fx.reload();
    let projection = fx.projection();
    assert_ne!(projection.version, second);
    assert_eq!(projection.epics[0].progress.doing, 1);
    assert_eq!(projection.epics[0].progress.total, 1);
}

#[test]
fn projection_project_changes_are_announced_with_the_project_resource() {
    let mut fx = Fx::new();
    // A rename is a summary change of the project.
    fx.store.rename_project(&fx.project, "Alpha two").unwrap();
    let sets = fx.reload();
    assert_eq!(
        facets_of(
            &sets,
            Resource::Project,
            ResourceId::Named(fx.project.to_string())
        ),
        Some(vec![Facet::Summary])
    );
    // A new project is a summary change of that project; a removed one is deleted.
    let other = fx.store.create_project("Beta", at(60)).unwrap().id;
    fx.index.reload_all(&fx.shared).unwrap();
    let sets = fx.index.take_changes();
    assert!(sets.iter().any(|set| set.project_id == other
        && set.changes[0].resource == Resource::Project
        && set.changes[0].facets == vec![Facet::Summary]));
    fx.store.delete_project(&other).unwrap();
    fx.index.reload_all(&fx.shared).unwrap();
    let sets = fx.index.take_changes();
    assert!(sets.iter().any(|set| set.project_id == other
        && set.changes[0].resource == Resource::Project
        && set.changes[0].facets == vec![Facet::Deleted]));
}

/// A second task (2) of the same project, created after task 1.
fn add_second_task(fx: &Fx) {
    fx.store
        .create_task(
            &fx.project,
            NewTask {
                title: "Second".into(),
                description: common::BODY.into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
                is_draft: false,
            },
            at(3),
        )
        .unwrap();
}

#[test]
fn projection_the_summary_fields_carry_the_creation_time_and_the_condition_read_error() {
    let mut fx = Fx::new();
    let fields = fx.projection().tasks[0].fields.clone();
    assert_eq!(fields.created_at, "2026-10-10T01:02:00Z");
    assert!(!fields.acceptance_error);

    // A TASK.md whose frontmatter cannot be read: the card says so, and keeps its other fields.
    let md_path = fx.task_dir(1).join("TASK.md");
    fs::write(&md_path, "---\nacceptance: [unclosed\n---\n\nbroken\n").unwrap();
    fx.reload();
    let broken = fx.projection().tasks[0].fields.clone();
    assert!(broken.acceptance_error);
    assert_eq!(broken.created_at, fields.created_at);
    assert_eq!(broken.title, fields.title);
}

#[test]
fn projection_an_epic_order_is_a_summary_change_and_leaves_the_document_version() {
    let mut fx = Fx::new();
    add_second_task(&fx);
    let alpha = EpicId::normalize("ALPHA").unwrap();
    for id in [1, 2] {
        fx.store
            .set_task_epic(&fx.project, id, Some(&alpha), Actor::Human, at(4))
            .unwrap();
    }
    fx.reload();
    let before = fx.projection().epics[0].clone();
    assert!(before.fields.priority.is_empty());
    assert!(!before.fields.priority_error);

    fx.store
        .set_epic_priority(&fx.project, &alpha, &[2, 1], at(5))
        .unwrap();
    let sets = fx.reload();
    let after = fx.projection().epics[0].clone();
    assert_eq!(after.fields.priority, vec![2, 1]);
    assert!(!after.fields.priority_error);
    let facets = epic_facets(&sets, "ALPHA").expect("the epic changed");
    assert!(facets.contains(&Facet::Summary), "{facets:?}");
    assert_ne!(after.summary_hash, before.summary_hash);
    assert_ne!(fx.projection().version, "");
    // The order lives in the EPIC.md frontmatter; the document the reader shows is unchanged.
    assert_eq!(after.document_version, before.document_version);
    assert!(!facets.contains(&Facet::Document), "{facets:?}");
}

#[test]
fn projection_an_unreadable_epic_order_is_reported_and_ignored() {
    let mut fx = Fx::new();
    let path = fx.epic_dir("ALPHA").join("EPIC.md");
    fs::write(&path, "---\npriority: nope\n---\n\nText.\n").unwrap();
    fx.reload();
    let fields = fx.projection().epics[0].fields.clone();
    assert!(fields.priority_error);
    assert!(fields.priority.is_empty());
}
