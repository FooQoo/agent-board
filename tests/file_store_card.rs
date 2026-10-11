//! Card creation, editing, drafts, archive, and delete on the shared files,
//! plus the lenient snapshot of broken cards (AC-9 and U1-1 to U1-8).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, Changed, NewCard, ProjectId};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::CardView;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}

fn later() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 5, 0, 0, 0).unwrap()
}

fn new_card(title: &str, description: &str) -> NewCard {
    NewCard {
        title: title.into(),
        description: description.into(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
        is_draft: false,
    }
}

/// A store on an empty `shared/` with one project.
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
    let project = store.create_project("Alpha", now()).unwrap().id;
    Fixture {
        _root: root,
        shared,
        store,
        project,
    }
}

impl Fixture {
    fn project_dir(&self) -> PathBuf {
        self.shared.join("projects").join(self.project.as_str())
    }

    fn card_dir(&self, id: i64) -> PathBuf {
        self.project_dir().join("tasks").join(id.to_string())
    }

    fn raw_task(&self, id: i64) -> serde_json::Value {
        let text = fs::read_to_string(self.card_dir(id).join("task.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn task_bytes(&self, id: i64) -> Vec<u8> {
        fs::read(self.card_dir(id).join("task.json")).unwrap()
    }

    fn body_bytes(&self, id: i64) -> Vec<u8> {
        fs::read(self.card_dir(id).join("TASK.md")).unwrap()
    }

    fn next_card_id(&self) -> i64 {
        let text = fs::read_to_string(self.project_dir().join("project.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        json["nextCardId"].as_i64().unwrap()
    }

    fn create(&self, title: &str) -> CardView {
        self.store
            .create_card(&self.project, new_card(title, ""), now())
            .unwrap()
    }
}

const VALID_BODY: &str = "## 作業内容\n\nDo the work.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. The thing works.\n  - 確認結果: 未確認\n  - 根拠: 手順\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";

#[test]
fn a_card_without_a_body_gets_the_template_headings_and_a_created_event() {
    let fx = fixture();
    let card = fx.create("Implement");

    assert_eq!(card.id, 1);
    assert_eq!(card.position, 1);
    assert_eq!(card.title, "Implement");
    assert_eq!(serde_json::to_value(card.card_status).unwrap(), "todo");
    assert_eq!(serde_json::to_value(card.agent_status).unwrap(), "idle");
    assert_eq!(card.history.len(), 1);
    assert_eq!(
        card.history[0].kind,
        agent_board::file_store::model::HistoryKind::Created
    );
    assert_eq!(fx.raw_task(1)["history"][0]["kind"], "created");
    assert_eq!(fx.raw_task(1)["history"][0]["actor"], "ai");
    assert_eq!(fx.next_card_id(), 2);

    let body = String::from_utf8(fx.body_bytes(1)).unwrap();
    assert!(body.contains("## Work"));
    assert!(body.contains("## Completion conditions"));
    assert!(body.contains("## Execution log"));
    assert_eq!(card.description, body);
}

#[test]
fn a_failed_save_keeps_the_number_reserved_and_leaves_no_temporary_folder() {
    let fx = fixture();
    fx.create("first");
    // A file where the second card's folder should go makes the final rename fail.
    fs::write(fx.project_dir().join("tasks").join("2"), "blocker").unwrap();

    let err = fx
        .store
        .create_card(&fx.project, new_card("second", ""), now())
        .unwrap_err();
    assert!(matches!(err, AgboardError::FileError { .. }), "{err:?}");

    let leftovers: Vec<String> = fs::read_dir(fx.project_dir().join("tasks"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with('.'))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert_eq!(
        fx.next_card_id(),
        3,
        "the failed number is reserved, not reused"
    );

    fs::remove_file(fx.project_dir().join("tasks").join("2")).unwrap();
    let next = fx.create("third");
    assert_eq!(next.id, 3);
}

#[test]
fn a_body_without_the_required_headings_is_refused_and_creates_nothing() {
    let fx = fixture();
    let err = fx
        .store
        .create_card(&fx.project, new_card("T", "just some text"), now())
        .unwrap_err();
    match err {
        AgboardError::FileInvalid { file, field, .. } => {
            assert_eq!(field, "## Work");
            assert!(file.ends_with("tasks/1/TASK.md"), "{file}");
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(
        fs::read_dir(fx.project_dir().join("tasks"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(fx.next_card_id(), 1, "a refused body reserves no number");
}

#[test]
fn a_completion_condition_without_its_detail_line_is_refused() {
    let fx = fixture();
    let body = VALID_BODY.replace("  - 根拠: 手順\n", "");
    let err = fx
        .store
        .create_card(&fx.project, new_card("T", &body), now())
        .unwrap_err();
    match err {
        AgboardError::FileInvalid { field, .. } => assert_eq!(field, "AC-1"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn a_valid_body_is_saved_as_given_with_crlf_turned_into_lf() {
    let fx = fixture();
    let body = VALID_BODY.replace('\n', "\r\n");
    let card = fx
        .store
        .create_card(&fx.project, new_card("T", &body), now())
        .unwrap();
    assert_eq!(fx.body_bytes(1), VALID_BODY.as_bytes());
    assert_eq!(card.description, VALID_BODY);
}

#[test]
fn editing_the_title_and_body_changes_them_and_moves_the_update_time() {
    let fx = fixture();
    fx.create("Old");
    let before = fx.raw_task(1);

    let Changed { value, changed } = fx
        .store
        .edit_card(&fx.project, 1, Some("New"), Some(VALID_BODY), later())
        .unwrap();
    assert!(changed);
    assert_eq!(value.title, "New");
    assert_eq!(value.description, VALID_BODY);
    let after = fx.raw_task(1);
    assert_eq!(after["updatedAt"], "2026-10-05T00:00:00Z");
    assert_eq!(after["agentStatus"], before["agentStatus"]);
    assert_eq!(after["cardStatus"], before["cardStatus"]);
    assert_eq!(
        after["history"], before["history"],
        "editing adds no history"
    );
}

#[test]
fn an_edit_that_changes_nothing_writes_nothing() {
    let fx = fixture();
    fx.create("Same");
    let task = fx.task_bytes(1);
    let body = fx.body_bytes(1);
    let result = fx
        .store
        .edit_card(&fx.project, 1, Some("Same"), None, later())
        .unwrap();
    assert!(!result.changed);
    assert_eq!(fx.task_bytes(1), task);
    assert_eq!(fx.body_bytes(1), body);
}

#[test]
fn a_draft_refuses_agent_edits_and_its_files_stay_unchanged() {
    let fx = fixture();
    fx.create("Draft");
    fx.store.set_draft(&fx.project, 1, true, now()).unwrap();
    let task = fx.task_bytes(1);
    let body = fx.body_bytes(1);

    let err = fx
        .store
        .edit_card(&fx.project, 1, Some("Changed"), Some(VALID_BODY), later())
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::CardIsDraft { id: 1 }),
        "{err:?}"
    );
    assert_eq!(fx.task_bytes(1), task);
    assert_eq!(fx.body_bytes(1), body);
}

#[test]
fn setting_the_draft_flag_adds_a_draft_event_and_keeps_the_update_time() {
    let fx = fixture();
    fx.create("Draft");
    let updated = fx.raw_task(1)["updatedAt"].clone();

    let changed = fx.store.set_draft(&fx.project, 1, true, later()).unwrap();
    assert!(changed.changed);
    assert!(changed.value.is_draft);
    let raw = fx.raw_task(1);
    assert_eq!(raw["isDraft"], true);
    assert_eq!(raw["updatedAt"], updated);
    assert_eq!(raw["history"][1]["kind"], "draft");
    assert_eq!(raw["history"][1]["isDraft"], true);

    let same = fx.store.set_draft(&fx.project, 1, true, later()).unwrap();
    assert!(!same.changed);
}

#[test]
fn finalizing_a_draft_saves_its_body_and_clears_the_flag() {
    let fx = fixture();
    fx.create("Draft");
    fx.store.set_draft(&fx.project, 1, true, now()).unwrap();

    let Changed { value, changed } = fx
        .store
        .edit_draft_card(&fx.project, 1, None, Some(VALID_BODY), true, later())
        .unwrap();
    assert!(changed);
    assert!(!value.is_draft);
    assert_eq!(fx.body_bytes(1), VALID_BODY.as_bytes());
    let raw = fx.raw_task(1);
    assert_eq!(raw["isDraft"], false);
    assert_eq!(
        raw["history"].as_array().unwrap().last().unwrap()["kind"],
        "draft"
    );
}

#[test]
fn a_card_that_is_not_a_draft_is_refused_by_the_draft_edit() {
    let fx = fixture();
    fx.create("Plain");
    let err = fx
        .store
        .edit_draft_card(&fx.project, 1, Some("X"), None, false, later())
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::CardNotDraft { id: 1 }),
        "{err:?}"
    );
}

#[test]
fn archiving_keeps_the_lane_and_position_and_restoring_puts_the_card_at_the_lane_end() {
    let fx = fixture();
    fx.create("one");
    fx.create("two");

    let archived = fx.store.archive_card(&fx.project, 1, later()).unwrap();
    assert!(archived.changed);
    assert!(archived.value.archived_at.is_some());
    assert_eq!(archived.value.position, 1);
    let raw = fx.raw_task(1);
    assert_eq!(
        raw["history"].as_array().unwrap().last().unwrap()["kind"],
        "archive"
    );
    assert_eq!(
        raw["history"].as_array().unwrap().last().unwrap()["reason"],
        "Archived by user."
    );

    let edit = fx
        .store
        .edit_card(&fx.project, 1, Some("x"), None, later())
        .unwrap_err();
    assert!(
        matches!(edit, AgboardError::CardArchived { id: 1 }),
        "{edit:?}"
    );

    let restored = fx.store.restore_card(&fx.project, 1, later()).unwrap();
    assert!(restored.changed);
    assert!(restored.value.archived_at.is_none());
    assert_eq!(restored.value.card_status.as_str(), "todo");
    assert_eq!(restored.value.position, 3);
}

#[test]
fn deleting_needs_an_archived_card_and_then_removes_its_folder() {
    let fx = fixture();
    fx.create("one");
    let err = fx.store.delete_archived_card(&fx.project, 1).unwrap_err();
    assert!(
        matches!(err, AgboardError::CardNotArchived { id: 1 }),
        "{err:?}"
    );

    fx.store.archive_card(&fx.project, 1, later()).unwrap();
    fx.store.delete_archived_card(&fx.project, 1).unwrap();
    assert!(!fx.card_dir(1).exists());
    assert!(matches!(
        fx.store.card(&fx.project, 1),
        Err(AgboardError::CardNotFound { id: 1 })
    ));
}

#[test]
fn card_numbers_are_not_reused_after_a_delete() {
    let fx = fixture();
    fx.create("one");
    fx.create("two");
    fx.store.archive_card(&fx.project, 2, later()).unwrap();
    fx.store.delete_archived_card(&fx.project, 2).unwrap();
    assert_eq!(fx.create("three").id, 3);
}

#[test]
fn concurrent_creations_get_unique_numbers_and_positions() {
    let fx = fixture();
    let shared = fx.shared.clone();
    let project = fx.project.clone();
    let handles: Vec<_> = (0..2)
        .map(|worker| {
            let shared = shared.clone();
            let project = project.clone();
            std::thread::spawn(move || {
                let store = FileStore::open(&shared);
                for n in 0..20 {
                    store
                        .create_card(&project, new_card(&format!("w{worker}-{n}"), ""), now())
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    let mut ids: Vec<i64> = snapshot.cards.iter().map(|c| c.id).collect();
    ids.sort_unstable();
    assert_eq!(ids, (1..=40).collect::<Vec<_>>());
    let mut positions: Vec<i64> = snapshot.cards.iter().map(|c| c.position).collect();
    positions.sort_unstable();
    assert_eq!(positions, (1..=40).collect::<Vec<_>>());
    assert_eq!(snapshot.next_card_id, 41);
    assert!(snapshot.problems.is_empty());
}

#[test]
fn a_card_with_a_broken_task_file_is_left_out_and_reported_by_its_relative_path() {
    let fx = fixture();
    fx.create("one");
    fx.create("two");
    let path = fx.card_dir(2).join("task.json");
    let mut json = fx.raw_task(2);
    json["extra"] = serde_json::json!(1);
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();

    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    let ids: Vec<i64> = snapshot.cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![1]);
    assert!(
        snapshot.problems.iter().any(|p| p.file
            == format!("projects/{}/tasks/2/task.json", fx.project)
            && p.field == "extra"),
        "{:?}",
        snapshot.problems
    );
}

#[test]
fn a_task_file_of_another_format_version_is_left_out_and_not_converted() {
    let fx = fixture();
    fx.create("one");
    let path = fx.card_dir(1).join("task.json");
    let mut json = fx.raw_task(1);
    json["formatVersion"] = serde_json::json!(2);
    let text = serde_json::to_string_pretty(&json).unwrap();
    fs::write(&path, &text).unwrap();

    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert!(snapshot.cards.is_empty());
    assert!(snapshot.problems.iter().any(|p| p.field == "formatVersion"));
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn writing_to_a_card_with_a_broken_task_file_is_refused() {
    let fx = fixture();
    fx.create("one");
    let mut json = fx.raw_task(1);
    json["extra"] = serde_json::json!(1);
    fs::write(
        fx.card_dir(1).join("task.json"),
        serde_json::to_string_pretty(&json).unwrap(),
    )
    .unwrap();
    let err = fx
        .store
        .edit_card(&fx.project, 1, Some("x"), None, later())
        .unwrap_err();
    assert!(matches!(err, AgboardError::FileInvalid { .. }), "{err:?}");
}

#[test]
fn a_body_defect_returns_the_text_and_is_reported_without_rewriting_it() {
    let fx = fixture();
    fx.create("one");
    let broken = fs::read_to_string(fx.card_dir(1).join("TASK.md"))
        .unwrap()
        .replace("## Execution log", "## Log");
    fs::write(fx.card_dir(1).join("TASK.md"), &broken).unwrap();

    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(snapshot.cards.len(), 1);
    assert_eq!(snapshot.cards[0].description, broken);
    assert!(snapshot.problems.iter().any(|p| p.file
        == format!("projects/{}/tasks/1/TASK.md", fx.project)
        && p.field == "## Execution log"));
    assert_eq!(
        fs::read_to_string(fx.card_dir(1).join("TASK.md")).unwrap(),
        broken
    );
}

#[test]
fn a_half_written_body_reads_as_a_problem_and_recovers_when_it_is_finished() {
    let fx = fixture();
    fx.create("one");
    // What a reader sees while an agent is still writing the file.
    fs::write(fx.card_dir(1).join("TASK.md"), "## 作業内容\n\nWriting").unwrap();
    let during = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(during.cards.len(), 1);
    assert!(!during.problems.is_empty());

    fs::write(fx.card_dir(1).join("TASK.md"), VALID_BODY).unwrap();
    let after = fx.store.snapshot(&fx.project).unwrap();
    assert!(after.problems.is_empty(), "{:?}", after.problems);
}

#[test]
fn a_missing_body_file_is_a_problem_with_an_empty_text() {
    let fx = fixture();
    fx.create("one");
    fs::remove_file(fx.card_dir(1).join("TASK.md")).unwrap();
    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(snapshot.cards[0].description, "");
    assert!(
        snapshot
            .problems
            .iter()
            .any(|p| p.file == format!("projects/{}/tasks/1/TASK.md", fx.project))
    );
}

#[test]
fn a_card_folder_name_that_is_not_canonical_is_ignored() {
    let fx = fixture();
    fx.create("one");
    fs::create_dir_all(fx.project_dir().join("tasks").join(".new-abc")).unwrap();
    fs::create_dir_all(fx.project_dir().join("tasks").join("07")).unwrap();
    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(snapshot.cards.len(), 1);
    assert!(snapshot.problems.is_empty(), "{:?}", snapshot.problems);
}

#[test]
fn a_card_read_strictly_matches_its_snapshot_view() {
    let fx = fixture();
    fx.create("one");
    let direct: CardView = fx.store.card(&fx.project, 1).unwrap();
    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(snapshot.cards[0], direct);
}
