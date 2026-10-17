//! Lane moves and agent run states on the shared files: the rules of the
//! state table (MODEL.md), reasons, request release on a move, and AC-6
//! (a completion report stays in Doing; a Done task's text stays editable).

use std::fs;
use std::path::PathBuf;

use agent_board::domain::{Actor, Assignee, ChangeContext, Column, NewTask, ProjectId, RunState};
use agent_board::error::AgboardError;
use agent_board::file_store::FileStore;
use agent_board::file_store::model::Choice;
use chrono::{TimeZone, Utc};

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}

fn later() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 5, 0, 0, 0).unwrap()
}

fn ctx(actor: Actor, reason: &str) -> ChangeContext {
    ChangeContext {
        actor,
        reason: reason.into(),
    }
}

const VALID_BODY: &str = "## 作業内容\n\nDo the work.\n\n## 完了条件と確認結果\n\n- [ ] AC-1. The thing works.\n  - 確認結果: 未確認\n  - 根拠: 手順\n  - 調整役の確認: 未確認\n\n## 実行記録\n\n";

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
    fn task_path(&self, id: i64) -> PathBuf {
        self.shared
            .join("projects")
            .join(self.project.as_str())
            .join("tasks")
            .join(id.to_string())
            .join("task.json")
    }

    fn history(&self, id: i64) -> serde_json::Value {
        let markdown = fs::read_to_string(self.task_path(id).with_file_name("TASK.md")).unwrap();
        let parsed = agent_board::file_store::history::parse_task(
            &markdown,
            agent_board::file_store::history::ParseMode::Stored,
        );
        serde_json::to_value(parsed.history).unwrap()
    }

    fn bytes(&self, id: i64) -> Vec<u8> {
        fs::read(self.task_path(id)).unwrap()
    }

    fn ai_task(&self, title: &str) -> i64 {
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
                now(),
            )
            .unwrap()
            .id
    }
}

#[test]
fn reporting_running_on_a_todo_task_is_refused_and_changes_nothing() {
    let fx = fixture();
    let id = fx.ai_task("todo");
    let before = fx.bytes(id);
    let err = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "Start"),
            None,
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::InvalidStateForAssignee),
        "{err:?}"
    );
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn running_on_a_human_task_in_doing_is_refused() {
    let fx = fixture();
    let id = fx
        .store
        .create_task(
            &fx.project,
            NewTask {
                title: "human".into(),
                description: String::new(),
                assignee: Assignee::Human,
                actor: Actor::Human,
                is_draft: false,
            },
            now(),
        )
        .unwrap()
        .id;
    fx.store
        .move_work_task_for_user(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Human, "Start"),
            later(),
        )
        .unwrap();
    let err = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Human, "x"),
            None,
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::InvalidStateForAssignee),
        "{err:?}"
    );
}

#[test]
fn a_running_and_idle_task_in_doing_keeps_its_lane_and_records_each_reason() {
    let fx = fixture();
    let id = fx.ai_task("work");
    let moved = fx
        .store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start work"),
            later(),
        )
        .unwrap();
    assert!(moved.changed);
    assert_eq!(moved.value.task_status, Column::Doing);

    fx.store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "Inspecting"),
            None,
            later(),
        )
        .unwrap();
    let reported = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Idle,
            ctx(Actor::Ai, "Report done"),
            None,
            later(),
        )
        .unwrap();
    // AC-6: a completion report stays in Doing until the coordinator moves it.
    assert_eq!(reported.value.task_status, Column::Doing);
    assert_eq!(reported.value.agent_status, RunState::Idle);

    assert_eq!(fx.history(id).as_array().unwrap().len(), 4);
    let reasons: Vec<String> = fx
        .history(id)
        .as_array()
        .unwrap()
        .iter()
        .skip(1)
        .map(|e| e["reason"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(reasons, vec!["Start work", "Inspecting", "Report done"]);
}

#[test]
fn a_lane_move_returns_the_task_to_idle_and_releases_its_request() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    let pending = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Which way?",
            vec![choice("a", "Plan A"), choice("b", "Plan B")],
            later(),
        )
        .unwrap();
    assert!(pending.value.pending_request_id.is_some());
    assert_eq!(pending.value.pending_reason.as_deref(), Some("Which way?"));

    let done = fx
        .store
        .move_work_task(
            &fx.project,
            id,
            Column::Done,
            ctx(Actor::Human, "Verified"),
            later(),
        )
        .unwrap();
    assert_eq!(done.value.task_status, Column::Done);
    assert_eq!(done.value.agent_status, RunState::Idle);
    assert!(done.value.pending_request_id.is_none());
    let last = fx.history(id).as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["reason"], "Verified");
    assert_eq!(last.as_object().unwrap().len(), 2);
}

#[test]
fn a_move_to_the_same_lane_changes_nothing() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    let before = fx.bytes(id);
    let same = fx
        .store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Again"),
            later(),
        )
        .unwrap();
    assert!(!same.changed);
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_draft_task_refuses_agent_moves_and_accepts_user_moves() {
    let fx = fixture();
    let id = fx.ai_task("draft");
    fx.store.set_draft(&fx.project, id, true, now()).unwrap();

    let err = fx
        .store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::TaskIsDraft { id: 1 }),
        "{err:?}"
    );

    let moved = fx
        .store
        .move_work_task_for_user(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Human, "Start"),
            later(),
        )
        .unwrap();
    assert_eq!(moved.value.task_status, Column::Doing);
}

#[test]
fn a_stale_or_missing_request_id_is_refused_when_leaving_pending() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    let pending = fx
        .store
        .request_decision(
            &fx.project,
            id,
            Actor::Ai,
            "Question",
            vec![choice("a", "Plan A"), choice("b", "Plan B")],
            later(),
        )
        .unwrap();
    let request = pending.value.pending_request_id.unwrap();

    for expected in [None, Some("ffffffffffffffffffffffffffffffff")] {
        let err = fx
            .store
            .set_agent_status(
                &fx.project,
                id,
                RunState::Running,
                ctx(Actor::Ai, "Resume"),
                expected,
                later(),
            )
            .unwrap_err();
        assert!(
            matches!(err, AgboardError::RequestChanged),
            "{expected:?}: {err:?}"
        );
    }

    let resumed = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "Resume"),
            Some(&request),
            later(),
        )
        .unwrap();
    assert_eq!(resumed.value.agent_status, RunState::Running);
    assert!(resumed.value.pending_request_id.is_none());
}

#[test]
fn a_repeated_state_is_not_a_change_even_with_another_reason() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    fx.store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "first"),
            None,
            later(),
        )
        .unwrap();
    let before = fx.bytes(id);
    let again = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "second"),
            None,
            later(),
        )
        .unwrap();
    assert!(!again.changed);
    assert_eq!(fx.bytes(id), before);
}

#[test]
fn a_blank_reason_generates_a_state_aware_default() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    let changed = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "   "),
            None,
            later(),
        )
        .unwrap();
    assert!(changed.changed);
    assert_eq!(
        changed.value.history.last().unwrap().reason,
        "Changed agent from idle to running in Doing."
    );
}

#[test]
fn done_tasks_reject_agent_edits_but_a_person_can_reopen_them() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Doing,
            ctx(Actor::Ai, "Start"),
            later(),
        )
        .unwrap();
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Done,
            ctx(Actor::Human, "Verified"),
            later(),
        )
        .unwrap();

    let before = fx.bytes(id);
    let err = fx
        .store
        .edit_task(&fx.project, id, Some("Renamed"), Some(VALID_BODY), later())
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::TaskIsDone { id: done } if done == id),
        "{err:?}"
    );
    assert_eq!(fx.bytes(id), before);

    let reopened = fx
        .store
        .move_work_task_for_user(
            &fx.project,
            id,
            Column::Todo,
            ctx(Actor::Human, "Reopen for follow-up"),
            later(),
        )
        .unwrap();
    assert!(reopened.changed);
    assert_eq!(reopened.value.task_status, Column::Todo);
    assert_eq!(reopened.value.agent_status, RunState::Idle);
    let snapshot = fx.store.snapshot(&fx.project).unwrap();
    assert_eq!(snapshot.tasks[0].task_status, Column::Todo);
    assert!(snapshot.problems.is_empty(), "{:?}", snapshot.problems);
}

#[test]
fn running_on_a_done_task_is_refused_by_the_state_table() {
    let fx = fixture();
    let id = fx.ai_task("work");
    fx.store
        .move_work_task(
            &fx.project,
            id,
            Column::Done,
            ctx(Actor::Human, "Verified"),
            later(),
        )
        .unwrap();
    let err = fx
        .store
        .set_agent_status(
            &fx.project,
            id,
            RunState::Running,
            ctx(Actor::Ai, "x"),
            None,
            later(),
        )
        .unwrap_err();
    assert!(
        matches!(err, AgboardError::TaskIsDone { id: done } if done == id),
        "{err:?}"
    );
}

fn choice(id: &str, label: &str) -> Choice {
    Choice {
        id: id.into(),
        label: label.into(),
    }
}
