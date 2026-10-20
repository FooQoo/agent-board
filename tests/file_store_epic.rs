//! Epic creation, update, deletion, and task membership on the shared files
//! (AC-2 storage layer, U4-1 and U4-2).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, NewTask, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::{EpicUpdate, EpicView, NewEpic, TaskView};
use agent_board::file_store::validate::EpicId;
use chrono::{TimeZone, Utc};

fn at(day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    shared: PathBuf,
    store: FileStore,
    project: ProjectId,
}

fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let shared = root.path().join("shared");
    let store = FileStore::open(&shared);
    let project = store.create_project("Alpha", at(4)).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

fn epic_id(text: &str) -> EpicId {
    EpicId::normalize(text).unwrap()
}

impl Fixture {
    fn project_dir(&self) -> PathBuf {
        self.shared.join("projects").join(self.project.as_str())
    }

    fn epic_dir(&self, id: &str) -> PathBuf {
        self.project_dir().join("epics").join(id)
    }

    fn task_dir(&self, id: i64) -> PathBuf {
        self.project_dir().join("tasks").join(id.to_string())
    }

    fn new_epic(&self, id: &str) -> Result<EpicView, AgboardError> {
        self.store.create_epic(
            &self.project,
            NewEpic {
                id: id.into(),
                name: "File share".into(),
                color: Some("#7c3aed".into()),
                is_draft: false,
                document: None,
            },
            at(4),
        )
    }

    fn task(&self, title: &str) -> TaskView {
        self.store
            .create_task(
                &self.project,
                NewTask {
                    title: title.into(),
                    description: String::new(),
                    assignee: Assignee::Ai,
                    actor: Actor::Ai,
                    is_draft: false,
                },
                at(4),
            )
            .unwrap()
    }
}

fn bytes_of(path: PathBuf) -> Vec<u8> {
    fs::read(path).unwrap()
}

#[test]
fn epic_conditions_are_body_text_and_not_managed_frontmatter() {
    let f = fixture();
    let document = "---\npriority: []\nacceptance: no-longer-managed\n---\n\n## Completion conditions\n\n- [ ] Reference condition.\n";
    let epic = f
        .store
        .create_epic(
            &f.project,
            NewEpic {
                id: "PLAIN".into(),
                name: "Plain document".into(),
                color: None,
                is_draft: false,
                document: Some(document.into()),
            },
            at(4),
        )
        .unwrap();
    assert_eq!(epic.document, document);
    assert!(epic.body.contains("- [ ] Reference condition."));
    let view = serde_json::to_value(&epic).unwrap();
    assert!(view.get("acceptance").is_none());
    assert!(view.get("acceptanceError").is_none());
    assert!(f.store.snapshot(&f.project).unwrap().problems.is_empty());
    let default = f.new_epic("DEFAULT").unwrap();
    assert!(!default.document.contains("acceptance:"));
}

#[test]
fn a_lowercase_epic_id_is_stored_in_uppercase_with_epic_json_and_document() {
    let f = fixture();
    let view = f.new_epic("file-share").unwrap();
    assert_eq!(view.id.as_str(), "FILE-SHARE");
    assert_eq!(view.color, "#7C3AED");

    let dir = f.epic_dir("FILE-SHARE");
    let json: serde_json::Value = serde_json::from_slice(&bytes_of(dir.join("epic.json"))).unwrap();
    assert_eq!(json["formatVersion"], 1);
    assert_eq!(json["id"], "FILE-SHARE");
    assert_eq!(json["name"], "File share");
    assert_eq!(json["color"], "#7C3AED");
    assert_eq!(json["isDraft"], false);
    assert_eq!(json["attachments"], serde_json::json!([]));
    assert_eq!(json["createdAt"], "2026-10-04T00:00:00Z");
    assert_eq!(json["updatedAt"], "2026-10-04T00:00:00Z");

    let document = fs::read_to_string(dir.join("EPIC.md")).unwrap();
    assert_eq!(document, "");
    let leftovers: Vec<String> = fs::read_dir(f.project_dir().join("epics"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        leftovers.iter().any(|name| name == "FILE-SHARE"),
        "{leftovers:?}"
    );
    assert!(
        leftovers.iter().all(|name| !name.starts_with(".new-")),
        "no .new-* folder is left: {leftovers:?}"
    );
}

#[test]
fn creating_an_epic_with_a_taken_id_is_refused_and_changes_nothing() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let json_before = bytes_of(f.epic_dir("FILE-SHARE").join("epic.json"));

    let err = f.new_epic("file-share").unwrap_err();

    assert!(matches!(err, AgboardError::EpicIdTaken { .. }), "{err:?}");
    assert_eq!(err.code(), "epic_id_taken");
    assert_eq!(
        bytes_of(f.epic_dir("FILE-SHARE").join("epic.json")),
        json_before
    );
}

#[test]
fn epic_ids_outside_the_grammar_are_refused_and_no_folder_is_made() {
    let f = fixture();
    let too_long = "A".repeat(65);
    for bad in [
        "",
        "1A",
        "-A",
        "A-",
        "A--B",
        "A_B",
        "A B",
        "ÉPIC",
        "../ESCAPE",
        "A/B",
        too_long.as_str(),
    ] {
        let err = f.new_epic(bad).unwrap_err();
        assert!(
            matches!(err, AgboardError::InvalidValue { .. }),
            "{bad:?} gave {err:?}"
        );
    }
    assert!(!f.project_dir().join("epics").join("ESCAPE").exists());
    // Only the two default epics exist; a refused ID adds no folder.
    let entries = fs::read_dir(f.project_dir().join("epics")).unwrap().count();
    assert_eq!(entries, 2);
}

#[test]
fn a_64_character_epic_id_is_accepted() {
    let f = fixture();
    let id = "A".repeat(64);
    assert_eq!(f.new_epic(&id).unwrap().id.as_str(), id);
}

#[test]
fn colors_are_stored_as_uppercase_hex_and_other_colors_are_refused() {
    let f = fixture();
    let view = f.new_epic("PALETTE").unwrap();
    assert_eq!(view.color, "#7C3AED");

    for bad in ["7c3aed", "#7c3ae", "#GGGGGG", "#1234567"] {
        let err = f
            .store
            .create_epic(
                &f.project,
                NewEpic {
                    id: format!("BAD-{}", bad.len()),
                    name: "Bad".into(),
                    color: Some(bad.into()),
                    is_draft: false,
                    document: None,
                },
                at(4),
            )
            .unwrap_err();
        assert!(
            matches!(err, AgboardError::InvalidValue { .. }),
            "{bad:?} gave {err:?}"
        );
    }
}

#[test]
fn an_epic_used_by_a_task_cannot_be_deleted_even_when_the_task_is_archived() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let task = f.task("Uses the epic");
    let epic = epic_id("FILE-SHARE");
    f.store
        .set_task_epic(&f.project, task.id, Some(&epic), Actor::Human, at(5))
        .unwrap();
    f.store.archive_task(&f.project, task.id, at(6)).unwrap();
    let json_before = bytes_of(f.epic_dir("FILE-SHARE").join("epic.json"));

    let err = f.store.delete_epic(&f.project, &epic).unwrap_err();

    assert!(matches!(err, AgboardError::EpicInUse { .. }), "{err:?}");
    assert_eq!(err.code(), "epic_in_use");
    assert_eq!(
        bytes_of(f.epic_dir("FILE-SHARE").join("epic.json")),
        json_before
    );
    assert!(f.epic_dir("FILE-SHARE").join("EPIC.md").is_file());
}

#[test]
fn an_unused_epic_is_removed_with_its_folder() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    f.store
        .delete_epic(&f.project, &epic_id("FILE-SHARE"))
        .unwrap();

    assert!(!f.epic_dir("FILE-SHARE").exists());
    let err = f
        .store
        .epic(&f.project, &epic_id("FILE-SHARE"))
        .unwrap_err();
    assert!(matches!(err, AgboardError::EpicNotFound { .. }), "{err:?}");
    assert_eq!(err.code(), "epic_not_found");
}

#[test]
fn setting_and_clearing_an_epic_records_history_only_for_real_changes() {
    let f = fixture();
    f.new_epic("ALPHA").unwrap();
    f.new_epic("BETA").unwrap();
    let task = f.task("Membership");
    let alpha = epic_id("ALPHA");
    let beta = epic_id("BETA");

    let set = f
        .store
        .set_task_epic(&f.project, task.id, Some(&alpha), Actor::Ai, at(5))
        .unwrap();
    assert!(set.changed);
    assert_eq!(set.value.epic_id.as_deref(), Some("ALPHA"));
    assert_eq!(
        set.value.history.last().unwrap().reason,
        "Changed epic from none to ALPHA."
    );
    let task_before = bytes_of(f.task_dir(task.id).join("task.json"));
    let same = f
        .store
        .set_task_epic(&f.project, task.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap();
    assert!(!same.changed);
    assert_eq!(
        bytes_of(f.task_dir(task.id).join("task.json")),
        task_before,
        "setting the same epic writes nothing"
    );

    let moved = f
        .store
        .set_task_epic(&f.project, task.id, Some(&beta), Actor::Human, at(7))
        .unwrap();
    assert_eq!(moved.value.epic_id.as_deref(), Some("BETA"));
    assert_eq!(moved.value.history.len(), 3);

    let cleared = f
        .store
        .set_task_epic(&f.project, task.id, None, Actor::Human, at(8))
        .unwrap();
    assert!(cleared.changed);
    assert_eq!(cleared.value.epic_id, None);
    assert_eq!(cleared.value.history.len(), 4);
    assert_eq!(
        cleared.value.history.last().unwrap().reason,
        "Changed epic from BETA to none."
    );
}

#[test]
fn setting_an_unknown_epic_is_refused_and_changes_nothing() {
    let f = fixture();
    let task = f.task("No epic yet");
    let task_before = bytes_of(f.task_dir(task.id).join("task.json"));

    let err = f
        .store
        .set_task_epic(
            &f.project,
            task.id,
            Some(&epic_id("NOPE")),
            Actor::Human,
            at(5),
        )
        .unwrap_err();

    assert!(matches!(err, AgboardError::EpicNotFound { .. }), "{err:?}");
    assert_eq!(bytes_of(f.task_dir(task.id).join("task.json")), task_before);
}

#[test]
fn an_agent_cannot_change_the_epic_of_an_archived_or_draft_task_but_a_human_can() {
    let f = fixture();
    f.new_epic("ALPHA").unwrap();
    let alpha = epic_id("ALPHA");

    let archived = f.task("Archived");
    f.store
        .archive_task(&f.project, archived.id, at(5))
        .unwrap();
    let err = f
        .store
        .set_task_epic(&f.project, archived.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskArchived { .. }), "{err:?}");
    let human = f
        .store
        .set_task_epic(&f.project, archived.id, Some(&alpha), Actor::Human, at(6))
        .unwrap();
    assert_eq!(human.value.epic_id.as_deref(), Some("ALPHA"));

    let draft = f.task("Draft");
    f.store
        .set_draft(&f.project, draft.id, true, at(5))
        .unwrap();
    let err = f
        .store
        .set_task_epic(&f.project, draft.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskIsDraft { .. }), "{err:?}");
    let human = f
        .store
        .set_task_epic(&f.project, draft.id, Some(&alpha), Actor::Human, at(6))
        .unwrap();
    assert_eq!(human.value.epic_id.as_deref(), Some("ALPHA"));
}

#[test]
fn update_changes_name_color_draft_and_document_and_refuses_a_broken_document() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let id = epic_id("FILE-SHARE");

    let changed = f
        .store
        .update_epic(
            &f.project,
            &id,
            EpicUpdate {
                name: Some("Renamed".into()),
                color: Some("#ff0000".into()),
                is_draft: Some(true),
                document: Some(valid_document("Updated goal")),
            },
            at(5),
        )
        .unwrap();
    assert!(changed.changed);
    assert_eq!(changed.value.name, "Renamed");
    assert_eq!(changed.value.color, "#FF0000");
    assert!(changed.value.is_draft);
    assert!(changed.value.document.contains("Updated goal"));
    assert_eq!(changed.value.updated_at, at(5));

    let same = f
        .store
        .update_epic(
            &f.project,
            &id,
            EpicUpdate {
                name: Some("Renamed".into()),
                ..EpicUpdate::default()
            },
            at(6),
        )
        .unwrap();
    assert!(!same.changed);
    assert_eq!(same.value.updated_at, at(5));

    let json_before = bytes_of(f.epic_dir("FILE-SHARE").join("epic.json"));
    let document_before = bytes_of(f.epic_dir("FILE-SHARE").join("EPIC.md"));
    let broken = "---\npriority: [\n---\n\n目的だけ\n";
    let err = f
        .store
        .update_epic(
            &f.project,
            &id,
            EpicUpdate {
                name: Some("Other".into()),
                document: Some(broken.into()),
                ..EpicUpdate::default()
            },
            at(7),
        )
        .unwrap_err();
    assert!(
        matches!(
            err,
            AgboardError::FileInvalid { .. } | AgboardError::InvalidValue { .. }
        ),
        "{err:?}"
    );
    assert_eq!(
        bytes_of(f.epic_dir("FILE-SHARE").join("EPIC.md")),
        document_before
    );
    assert_eq!(
        bytes_of(f.epic_dir("FILE-SHARE").join("epic.json")),
        json_before
    );
}

#[test]
fn the_epic_name_is_trimmed_and_must_fit_on_one_line() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let id = epic_id("FILE-SHARE");
    for bad in ["   ", "two\nlines", &"x".repeat(101)] {
        let err = f
            .store
            .update_epic(
                &f.project,
                &id,
                EpicUpdate {
                    name: Some(bad.into()),
                    ..EpicUpdate::default()
                },
                at(5),
            )
            .unwrap_err();
        assert!(matches!(err, AgboardError::InvalidValue { .. }), "{err:?}");
    }
    let trimmed = f
        .store
        .update_epic(
            &f.project,
            &id,
            EpicUpdate {
                name: Some("  Padded  ".into()),
                ..EpicUpdate::default()
            },
            at(5),
        )
        .unwrap();
    assert_eq!(trimmed.value.name, "Padded");
}

#[test]
fn an_epic_id_cannot_name_a_path_outside_the_epics_folder() {
    assert!(EpicId::normalize("../task").is_err());
    assert!(EpicId::normalize("a/../b").is_err());
    assert!(EpicId::normalize("/etc").is_err());
    assert!("../task".parse::<EpicId>().is_err());
    assert!("file-share".parse::<EpicId>().is_err(), "parsing is strict");
    assert_eq!(
        EpicId::normalize("file-share").unwrap().as_str(),
        "FILE-SHARE"
    );
}

fn valid_document(goal: &str) -> String {
    format!("---\nacceptance:\n  - id: AC-1\n    text: 条件\n    done: false\n---\n\n{goal}\n")
}

#[test]
fn an_ai_cannot_change_epic_membership_after_a_task_is_done() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let task = f.task("Completed task");
    f.store
        .move_work_task(
            &f.project,
            task.id,
            agent_board::domain::Column::Done,
            agent_board::domain::ChangeContext {
                actor: Actor::Ai,
                reason: "Finished".into(),
            },
            at(5),
        )
        .unwrap();

    let err = f
        .store
        .set_task_epic(
            &f.project,
            task.id,
            Some(&epic_id("FILE-SHARE")),
            Actor::Ai,
            at(6),
        )
        .unwrap_err();
    assert!(matches!(err, AgboardError::TaskIsDone { id } if id == task.id));
}

fn epic_ids(f: &Fixture) -> Vec<String> {
    f.store
        .board(&f.project)
        .unwrap()
        .epics
        .iter()
        .map(|epic| epic.id.as_str().to_string())
        .collect()
}

#[test]
fn a_new_project_starts_with_the_default_epics_and_one_can_be_deleted() {
    let f = fixture();
    assert_eq!(epic_ids(&f), ["BUG", "ENHANCEMENT"]);
    f.store.delete_epic(&f.project, &epic_id("BUG")).unwrap();
    assert_eq!(epic_ids(&f), ["ENHANCEMENT"]);
}

#[test]
fn a_deleted_default_epic_is_not_offered_again() {
    let f = fixture();
    f.store.delete_epic(&f.project, &epic_id("BUG")).unwrap();
    f.store.seed_default_epics(&f.project, at(5)).unwrap();
    f.store.seed_unseeded_projects(at(5));
    assert_eq!(epic_ids(&f), ["ENHANCEMENT"]);
}

#[test]
fn an_existing_project_is_offered_the_defaults_once_on_start() {
    let f = fixture();
    // A project from before the defaults: no default epics and no seeded flag.
    f.store.delete_epic(&f.project, &epic_id("BUG")).unwrap();
    f.store
        .delete_epic(&f.project, &epic_id("ENHANCEMENT"))
        .unwrap();
    let path = f.project_dir().join("project.json");
    let mut file: serde_json::Value = serde_json::from_slice(&bytes_of(path.clone())).unwrap();
    file.as_object_mut().unwrap().remove("defaultEpicsSeeded");
    fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();

    f.store.seed_unseeded_projects(at(6));
    assert_eq!(epic_ids(&f), ["BUG", "ENHANCEMENT"]);

    f.store.delete_epic(&f.project, &epic_id("BUG")).unwrap();
    f.store.seed_unseeded_projects(at(7));
    assert_eq!(epic_ids(&f), ["ENHANCEMENT"]);
}

#[test]
fn a_default_epic_in_use_by_a_task_is_refused_and_kept() {
    let f = fixture();
    let task = f.task("Bug report");
    f.store
        .set_task_epic(&f.project, task.id, Some(&epic_id("BUG")), Actor::Ai, at(5))
        .unwrap();
    let err = f
        .store
        .delete_epic(&f.project, &epic_id("BUG"))
        .unwrap_err();
    assert!(matches!(err, AgboardError::EpicInUse { .. }), "{err:?}");
    assert_eq!(epic_ids(&f), ["BUG", "ENHANCEMENT"]);
}
