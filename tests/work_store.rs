use chrono::{TimeZone, Utc};
use skan::{
    domain::{Actor, Assignee, ChangeContext, Column, NewCard, RunState},
    store::Store,
};
use tempfile::tempdir;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 4, 0, 0, 0).unwrap()
}
fn context(actor: Actor, reason: &str) -> ChangeContext {
    ChangeContext {
        actor,
        reason: reason.into(),
    }
}

#[test]
fn creates_moves_and_records_status_history_with_revision() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = Store::open(&path).unwrap();
    store.create_board("Agent Board", now()).unwrap();
    let card = store
        .add_work_card(
            NewCard {
                title: "Implement".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
            },
            now(),
        )
        .unwrap();
    let json = serde_json::to_value(&card).unwrap();
    assert_eq!(json["assignee"], "ai");
    assert_eq!(json["cardStatus"], "todo");
    assert_eq!(json["agentStatus"], "idle");
    assert!(json.get("column").is_none());
    assert_eq!(store.snapshot().unwrap().revision, 1);
    let moved = store
        .move_work_card(
            card.id,
            Column::Doing,
            context(Actor::Ai, "Start work"),
            now(),
        )
        .unwrap();
    assert!(moved.changed);
    assert_eq!(moved.value.history.len(), 2);
    let running = store
        .set_agent_status(
            card.id,
            RunState::Running,
            context(Actor::Ai, "Inspecting"),
            None,
            now(),
        )
        .unwrap();
    assert_eq!(running.value.history.len(), 3);
    let pending = store
        .set_agent_status(
            card.id,
            RunState::Pending,
            context(Actor::Ai, "Need a decision"),
            None,
            now(),
        )
        .unwrap()
        .value;
    let req = pending.pending_request_id.clone().unwrap();
    assert!(
        store
            .set_agent_status(
                card.id,
                RunState::Running,
                context(Actor::Ai, "Resume stale request"),
                Some("stale"),
                now(),
            )
            .is_err()
    );
    let resumed = store
        .answer_request(
            card.id,
            &req,
            context(Actor::Human, "Proceed with option A"),
            now(),
        )
        .unwrap();
    assert_eq!(resumed.agent_status, RunState::Idle);
    assert_eq!(
        resumed.history.last().unwrap().request_id.as_deref(),
        Some(req.as_str())
    );
    assert_eq!(store.snapshot().unwrap().revision, 5);
}

#[test]
fn invalid_assignee_and_stale_request_leave_state_unchanged() {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("board.db")).unwrap();
    store.create_board("Agent Board", now()).unwrap();
    let user = store
        .add_work_card(
            NewCard {
                title: "Review".into(),
                description: "".into(),
                assignee: Assignee::Human,
                actor: Actor::Human,
            },
            now(),
        )
        .unwrap();
    assert!(
        store
            .set_agent_status(
                user.id,
                RunState::Running,
                context(Actor::Human, "work"),
                None,
                now()
            )
            .is_err()
    );
    assert_eq!(store.snapshot().unwrap().revision, 1);
    assert!(
        store
            .answer_request(user.id, "stale", context(Actor::Human, "answer"), now())
            .is_err()
    );
    assert_eq!(store.snapshot().unwrap().revision, 1);
}

#[test]
fn read_only_open_does_not_create_missing_database() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("missing.db");
    assert!(Store::open_read_only(&path).is_err());
    assert!(!path.exists());
}

#[test]
fn history_failure_rolls_back_state_timestamp_and_revision() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = Store::open(&path).unwrap();
    store.create_board("Agent Board", now()).unwrap();
    let card = store
        .add_work_card(
            NewCard {
                title: "Work".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
            },
            now(),
        )
        .unwrap();
    store
        .move_work_card(card.id, Column::Doing, context(Actor::Ai, "Start"), now())
        .unwrap();
    let before = store.snapshot().unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_history BEFORE INSERT ON history WHEN NEW.kind='agent' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(
        store
            .set_agent_status(
                card.id,
                RunState::Running,
                context(Actor::Ai, "Run"),
                None,
                now()
            )
            .is_err()
    );
    let after = store.snapshot().unwrap();
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.cards[0].agent_status, RunState::Idle);
    assert_eq!(after.cards[0].updated_at, before.cards[0].updated_at);
    assert_eq!(after.cards[0].history, before.cards[0].history);
}

#[test]
fn setting_the_same_agent_state_is_a_revision_preserving_noop() {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("board.db")).unwrap();
    store.create_board("Agent Board", now()).unwrap();
    let card = store
        .add_work_card(
            NewCard {
                title: "Work".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
            },
            now(),
        )
        .unwrap();
    store
        .move_work_card(card.id, Column::Doing, context(Actor::Ai, "Start"), now())
        .unwrap();
    let before = store.snapshot().unwrap();
    let result = store
        .set_agent_status(
            card.id,
            RunState::Idle,
            context(Actor::Ai, "No change"),
            None,
            now(),
        )
        .unwrap();
    let after = store.snapshot().unwrap();
    assert!(!result.changed);
    assert_eq!(before.revision, after.revision);
    assert_eq!(before.cards[0].history, after.cards[0].history);
}

#[test]
fn moving_a_running_card_to_done_records_one_lane_event_and_resets_idle() {
    let dir = tempdir().unwrap();
    let store = Store::open(&dir.path().join("board.db")).unwrap();
    store.create_board("Agent Board", now()).unwrap();
    let card = store
        .add_work_card(
            NewCard {
                title: "Finish".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Ai,
            },
            now(),
        )
        .unwrap();
    store
        .move_work_card(card.id, Column::Doing, context(Actor::Ai, "Start"), now())
        .unwrap();
    store
        .set_agent_status(
            card.id,
            RunState::Running,
            context(Actor::Ai, "Working"),
            None,
            now(),
        )
        .unwrap();
    let done = store
        .move_work_card(
            card.id,
            Column::Done,
            context(Actor::Human, "Reviewed and complete"),
            now(),
        )
        .unwrap();
    assert_eq!(done.value.agent_status, RunState::Idle);
    assert_eq!(done.value.history.len(), 4);
    let event = done.value.history.last().unwrap();
    assert_eq!(event.kind, skan::domain::HistoryKind::Lane);
    assert_eq!(event.from_agent_status, Some(RunState::Running));
    assert_eq!(event.to_agent_status, RunState::Idle);
}
