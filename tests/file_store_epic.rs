//! Epic creation, update, deletion, and card membership on the shared files
//! (AC-2 storage layer, U4-1 and U4-2).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, NewCard, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::{CardView, EpicUpdate, EpicView, NewEpic};
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

    fn card_dir(&self, id: i64) -> PathBuf {
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
                plan: None,
            },
            at(4),
        )
    }

    fn card(&self, title: &str) -> CardView {
        self.store
            .create_card(
                &self.project,
                NewCard {
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
fn a_lowercase_epic_id_is_stored_in_uppercase_with_epic_json_and_plan() {
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

    let plan = fs::read_to_string(dir.join("PLAN.md")).unwrap();
    assert_eq!(plan, "---\nacceptance: []\n---\n\n");
    let leftovers: Vec<String> = fs::read_dir(f.project_dir().join("epics"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftovers, vec!["FILE-SHARE"], "no .new-* folder is left");
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
    let entries = fs::read_dir(f.project_dir().join("epics")).unwrap().count();
    assert_eq!(entries, 0);
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
                    plan: None,
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
fn an_epic_used_by_a_card_cannot_be_deleted_even_when_the_card_is_archived() {
    let f = fixture();
    f.new_epic("FILE-SHARE").unwrap();
    let card = f.card("Uses the epic");
    let epic = epic_id("FILE-SHARE");
    f.store
        .set_card_epic(&f.project, card.id, Some(&epic), Actor::Human, at(5))
        .unwrap();
    f.store.archive_card(&f.project, card.id, at(6)).unwrap();
    let json_before = bytes_of(f.epic_dir("FILE-SHARE").join("epic.json"));

    let err = f.store.delete_epic(&f.project, &epic).unwrap_err();

    assert!(matches!(err, AgboardError::EpicInUse { .. }), "{err:?}");
    assert_eq!(err.code(), "epic_in_use");
    assert_eq!(
        bytes_of(f.epic_dir("FILE-SHARE").join("epic.json")),
        json_before
    );
    assert!(f.epic_dir("FILE-SHARE").join("PLAN.md").is_file());
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
    let card = f.card("Membership");
    let alpha = epic_id("ALPHA");
    let beta = epic_id("BETA");

    let set = f
        .store
        .set_card_epic(&f.project, card.id, Some(&alpha), Actor::Ai, at(5))
        .unwrap();
    assert!(set.changed);
    assert_eq!(set.value.epic_id.as_deref(), Some("ALPHA"));
    let epic_events: Vec<_> = set
        .value
        .history
        .iter()
        .filter(|e| e.from_epic_id.is_some() || e.to_epic_id.is_some())
        .collect();
    assert_eq!(epic_events.len(), 1);
    assert_eq!(epic_events[0].from_epic_id, None);
    assert_eq!(epic_events[0].to_epic_id.as_deref(), Some("ALPHA"));
    assert_eq!(epic_events[0].actor, Actor::Ai);

    let task_before = bytes_of(f.card_dir(card.id).join("task.json"));
    let same = f
        .store
        .set_card_epic(&f.project, card.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap();
    assert!(!same.changed);
    assert_eq!(
        bytes_of(f.card_dir(card.id).join("task.json")),
        task_before,
        "setting the same epic writes nothing"
    );

    let moved = f
        .store
        .set_card_epic(&f.project, card.id, Some(&beta), Actor::Human, at(7))
        .unwrap();
    assert_eq!(moved.value.epic_id.as_deref(), Some("BETA"));
    assert_eq!(moved.value.history.len(), 3);

    let cleared = f
        .store
        .set_card_epic(&f.project, card.id, None, Actor::Human, at(8))
        .unwrap();
    assert!(cleared.changed);
    assert_eq!(cleared.value.epic_id, None);
    assert_eq!(cleared.value.history.len(), 4);
    assert_eq!(cleared.value.history.last().unwrap().to_epic_id, None);
}

#[test]
fn setting_an_unknown_epic_is_refused_and_changes_nothing() {
    let f = fixture();
    let card = f.card("No epic yet");
    let task_before = bytes_of(f.card_dir(card.id).join("task.json"));

    let err = f
        .store
        .set_card_epic(
            &f.project,
            card.id,
            Some(&epic_id("NOPE")),
            Actor::Human,
            at(5),
        )
        .unwrap_err();

    assert!(matches!(err, AgboardError::EpicNotFound { .. }), "{err:?}");
    assert_eq!(bytes_of(f.card_dir(card.id).join("task.json")), task_before);
}

#[test]
fn an_agent_cannot_change_the_epic_of_an_archived_or_draft_card_but_a_human_can() {
    let f = fixture();
    f.new_epic("ALPHA").unwrap();
    let alpha = epic_id("ALPHA");

    let archived = f.card("Archived");
    f.store
        .archive_card(&f.project, archived.id, at(5))
        .unwrap();
    let err = f
        .store
        .set_card_epic(&f.project, archived.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::CardArchived { .. }), "{err:?}");
    let human = f
        .store
        .set_card_epic(&f.project, archived.id, Some(&alpha), Actor::Human, at(6))
        .unwrap();
    assert_eq!(human.value.epic_id.as_deref(), Some("ALPHA"));

    let draft = f.card("Draft");
    f.store
        .set_draft(&f.project, draft.id, true, at(5))
        .unwrap();
    let err = f
        .store
        .set_card_epic(&f.project, draft.id, Some(&alpha), Actor::Ai, at(6))
        .unwrap_err();
    assert!(matches!(err, AgboardError::CardIsDraft { .. }), "{err:?}");
    let human = f
        .store
        .set_card_epic(&f.project, draft.id, Some(&alpha), Actor::Human, at(6))
        .unwrap();
    assert_eq!(human.value.epic_id.as_deref(), Some("ALPHA"));
}

#[test]
fn update_changes_name_color_draft_and_plan_and_refuses_a_broken_plan() {
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
                plan: Some(valid_plan("Updated goal")),
            },
            at(5),
        )
        .unwrap();
    assert!(changed.changed);
    assert_eq!(changed.value.name, "Renamed");
    assert_eq!(changed.value.color, "#FF0000");
    assert!(changed.value.is_draft);
    assert!(changed.value.plan.contains("Updated goal"));
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
    let plan_before = bytes_of(f.epic_dir("FILE-SHARE").join("PLAN.md"));
    let broken = "---\nacceptance: nope\n---\n\n目的だけ\n";
    let err = f
        .store
        .update_epic(
            &f.project,
            &id,
            EpicUpdate {
                name: Some("Other".into()),
                plan: Some(broken.into()),
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
        bytes_of(f.epic_dir("FILE-SHARE").join("PLAN.md")),
        plan_before
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

fn valid_plan(goal: &str) -> String {
    format!("---\nacceptance:\n  - id: AC-1\n    text: 条件\n    done: false\n---\n\n{goal}\n")
}
