use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use skan::domain::{BoardSnapshot, Card, Column, RunState, Transition};
use skan::error::SkanError;
use skan::store::Store;
use tempfile::TempDir;

fn t(minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, minute, 0).unwrap()
}

/// A store in a fresh temp dir. Keep the `TempDir` alive for the test.
fn open_store() -> (TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("board.db")).unwrap();
    (dir, store)
}

/// A store with an initialized board named "main", created at t(0).
fn board_store() -> (TempDir, Store) {
    let (dir, store) = open_store();
    store.create_board("main", t(0)).unwrap();
    (dir, store)
}

fn raw(dir: &TempDir) -> Connection {
    Connection::open(dir.path().join("board.db")).unwrap()
}

fn count(dir: &TempDir, table: &str) -> i64 {
    raw(dir)
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn invalid(field: &str) -> impl Fn(&SkanError) -> bool + '_ {
    move |e| matches!(e, SkanError::InvalidValue { field: f, .. } if f == field)
}

// ---------------------------------------------------------------- board

#[test]
fn uninitialized_store_has_no_board_and_card_operations_fail() {
    let (dir, store) = open_store();
    assert_eq!(store.board().unwrap(), None);
    let ni = Err(SkanError::NotInitialized);
    assert_eq!(store.add_card("x", "", t(1)).map(|_| ()), ni);
    assert_eq!(store.edit_card(1, Some("x"), None, t(1)).map(|_| ()), ni);
    assert_eq!(store.move_card(1, Column::Doing, t(1)).map(|_| ()), ni);
    assert_eq!(
        store
            .set_run_state(1, RunState::Idle, None, t(1))
            .map(|_| ()),
        ni
    );
    assert_eq!(store.delete_card(1), ni);
    assert_eq!(store.card(1).map(|_| ()), ni);
    assert_eq!(store.list_cards(None, None).map(|_| ()), ni);
    assert_eq!(store.snapshot().map(|_| ()), ni);
    // nothing was created by the failed operations
    assert_eq!(store.board().unwrap(), None);
    assert_eq!(count(&dir, "board"), 0);
    assert_eq!(count(&dir, "cards"), 0);
}

#[test]
fn create_board_starts_at_card_id_one() {
    let (_dir, store) = open_store();
    let meta = store.create_board("  simplekanban ", t(0)).unwrap();
    assert_eq!(meta.name, "simplekanban");
    assert_eq!(meta.next_card_id, 1);
    assert_eq!(meta.created_at, t(0));
    assert_eq!(store.board().unwrap(), Some(meta));
}

#[test]
fn create_board_rejects_invalid_names_without_changing_the_db() {
    let (_dir, store) = open_store();
    for name in ["", "   ", "two\nlines", &"a".repeat(51)] {
        let err = store.create_board(name, t(0)).unwrap_err();
        assert!(invalid("name")(&err), "{name:?}: {err:?}");
    }
    assert_eq!(store.board().unwrap(), None);
}

#[test]
fn create_board_when_one_exists_is_an_internal_error_and_changes_nothing() {
    let (_dir, store) = board_store();
    store.add_card("keep me", "", t(1)).unwrap();
    let err = store.create_board("other", t(2)).unwrap_err();
    assert!(matches!(err, SkanError::DatabaseError { .. }), "{err:?}");
    let meta = store.board().unwrap().unwrap();
    assert_eq!(meta.name, "main");
    assert_eq!(meta.next_card_id, 2);
    assert_eq!(store.list_cards(None, None).unwrap().len(), 1);
}

#[test]
fn reset_board_deletes_cards_and_transitions_and_restarts_ids() {
    let (dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.add_card("b", "", t(2)).unwrap();
    store.move_card(1, Column::Doing, t(3)).unwrap();
    assert_eq!(count(&dir, "transitions"), 3);

    let meta = store.reset_board("fresh", t(10)).unwrap();
    assert_eq!(meta.name, "fresh");
    assert_eq!(meta.next_card_id, 1);
    assert_eq!(meta.created_at, t(10));
    assert_eq!(store.board().unwrap(), Some(meta));
    assert_eq!(store.list_cards(None, None).unwrap(), vec![]);
    assert_eq!(count(&dir, "transitions"), 0);

    let card = store.add_card("again", "", t(11)).unwrap();
    assert_eq!(card.id, 1);
    assert_eq!(card.position, 1);
}

#[test]
fn reset_board_with_invalid_name_keeps_everything() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    let err = store.reset_board("", t(2)).unwrap_err();
    assert!(invalid("name")(&err));
    assert_eq!(store.board().unwrap().unwrap().name, "main");
    assert_eq!(store.list_cards(None, None).unwrap().len(), 1);
}

#[test]
fn reset_board_works_without_an_existing_board() {
    let (_dir, store) = open_store();
    let meta = store.reset_board("first", t(5)).unwrap();
    assert_eq!(meta.next_card_id, 1);
    assert_eq!(store.board().unwrap(), Some(meta));
}

// ---------------------------------------------------------------- add

#[test]
fn add_card_creates_an_idle_todo_card_with_a_creation_transition() {
    let (_dir, store) = board_store();
    let card = store
        .add_card("  First card  ", "line1\r\nline2", t(1))
        .unwrap();
    assert_eq!(
        card,
        Card {
            id: 1,
            title: "First card".into(),
            description: "line1\nline2".into(),
            column: Column::Todo,
            position: 1,
            run_state: RunState::Idle,
            pending_reason: None,
            created_at: t(1),
            updated_at: t(1),
            run_state_changed_at: t(1),
            transitions: vec![Transition {
                from: None,
                to: Column::Todo,
                at: t(1)
            }],
        }
    );
    assert_eq!(store.card(1).unwrap(), card);
}

#[test]
fn add_card_increments_ids_positions_and_next_card_id() {
    let (_dir, store) = board_store();
    let a = store.add_card("a", "", t(1)).unwrap();
    let b = store.add_card("b", "", t(2)).unwrap();
    let c = store.add_card("c", "", t(3)).unwrap();
    assert_eq!((a.id, a.position), (1, 1));
    assert_eq!((b.id, b.position), (2, 2));
    assert_eq!((c.id, c.position), (3, 3));
    assert_eq!(store.board().unwrap().unwrap().next_card_id, 4);
}

#[test]
fn add_card_places_at_the_end_of_todo_using_the_max_position() {
    let (_dir, store) = board_store();
    for title in ["a", "b", "c"] {
        store.add_card(title, "", t(1)).unwrap();
    }
    store.move_card(2, Column::Doing, t(2)).unwrap();
    // todo now holds positions {1, 3}; the next card goes to 4
    assert_eq!(store.add_card("d", "", t(3)).unwrap().position, 4);
    // deleting the last card frees its position but not its ID
    store.delete_card(4).unwrap();
    let e = store.add_card("e", "", t(4)).unwrap();
    assert_eq!((e.id, e.position), (5, 4));
}

#[test]
fn add_card_rejects_invalid_input_without_changing_the_db() {
    let (dir, store) = board_store();
    for title in ["", "  ", "a\nb", &"a".repeat(101)] {
        let err = store.add_card(title, "", t(1)).unwrap_err();
        assert!(invalid("title")(&err), "{title:?}: {err:?}");
    }
    let err = store.add_card("ok", &"a".repeat(301), t(1)).unwrap_err();
    assert!(invalid("description")(&err));
    assert_eq!(store.board().unwrap().unwrap().next_card_id, 1);
    assert_eq!(count(&dir, "cards"), 0);
    assert_eq!(count(&dir, "transitions"), 0);
}

#[test]
fn add_card_accepts_boundary_lengths() {
    let (_dir, store) = board_store();
    let card = store
        .add_card(&"あ".repeat(100), &"い".repeat(300), t(1))
        .unwrap();
    assert_eq!(card.title.chars().count(), 100);
    assert_eq!(card.description.chars().count(), 300);
}

// ---------------------------------------------------------------- edit

#[test]
fn edit_card_changes_only_the_given_fields() {
    let (_dir, store) = board_store();
    store.add_card("old", "desc", t(1)).unwrap();

    let (card, changed) = store.edit_card(1, Some(" new "), None, t(2)).unwrap();
    assert!(changed);
    assert_eq!(
        (card.title.as_str(), card.description.as_str()),
        ("new", "desc")
    );
    assert_eq!(card.updated_at, t(2));
    assert_eq!(card.created_at, t(1));
    assert_eq!(card.run_state_changed_at, t(1));
    assert_eq!(card.transitions.len(), 1);

    let (card, changed) = store
        .edit_card(1, None, Some("other\r\ntext"), t(3))
        .unwrap();
    assert!(changed);
    assert_eq!(
        (card.title.as_str(), card.description.as_str()),
        ("new", "other\ntext")
    );
    assert_eq!(card.updated_at, t(3));
}

#[test]
fn edit_card_can_clear_the_description() {
    let (_dir, store) = board_store();
    store.add_card("a", "something", t(1)).unwrap();
    let (card, changed) = store.edit_card(1, None, Some(""), t(2)).unwrap();
    assert!(changed);
    assert_eq!(card.description, "");
}

#[test]
fn edit_card_with_same_values_changes_nothing() {
    let (_dir, store) = board_store();
    let original = store.add_card("a", "d", t(1)).unwrap();
    let (card, changed) = store.edit_card(1, Some("a"), Some("d"), t(2)).unwrap();
    assert!(!changed);
    assert_eq!(card, original);
    // a title that only differs by surrounding space is the same title
    let (card, changed) = store.edit_card(1, Some("  a  "), None, t(3)).unwrap();
    assert!(!changed);
    assert_eq!(card.updated_at, t(1));
    // nothing to change at all
    let (card, changed) = store.edit_card(1, None, None, t(4)).unwrap();
    assert!(!changed);
    assert_eq!(card, original);
}

#[test]
fn edit_card_rejects_invalid_input_and_missing_cards() {
    let (_dir, store) = board_store();
    let original = store.add_card("a", "d", t(1)).unwrap();
    assert!(invalid("title")(
        &store.edit_card(1, Some(""), None, t(2)).unwrap_err()
    ));
    assert!(invalid("description")(
        &store
            .edit_card(1, None, Some(&"x".repeat(301)), t(2))
            .unwrap_err()
    ));
    // a valid title next to an invalid description must not be applied
    assert!(invalid("description")(
        &store
            .edit_card(1, Some("b"), Some(&"x".repeat(301)), t(2))
            .unwrap_err()
    ));
    assert_eq!(store.card(1).unwrap(), original);
    assert_eq!(
        store.edit_card(99, Some("x"), None, t(2)).map(|_| ()),
        Err(SkanError::CardNotFound { id: 99 })
    );
}

// ---------------------------------------------------------------- move

#[test]
fn move_card_goes_to_the_end_of_the_target_column_and_records_a_transition() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.add_card("b", "", t(1)).unwrap();
    let (a, changed) = store.move_card(1, Column::Doing, t(2)).unwrap();
    assert!(changed);
    assert_eq!((a.column, a.position), (Column::Doing, 1));
    assert_eq!(a.updated_at, t(2));
    assert_eq!(a.run_state, RunState::Idle);
    assert_eq!(
        a.transitions.last().unwrap(),
        &Transition {
            from: Some(Column::Todo),
            to: Column::Doing,
            at: t(2)
        }
    );
    let (b, _) = store.move_card(2, Column::Doing, t(3)).unwrap();
    assert_eq!(b.position, 2);
    let (a, _) = store.move_card(1, Column::Done, t(4)).unwrap();
    assert_eq!((a.column, a.position), (Column::Done, 1));
    let (b, _) = store.move_card(2, Column::Done, t(5)).unwrap();
    assert_eq!(b.position, 2);
    assert_eq!(a.transitions.len(), 3);
}

#[test]
fn move_card_to_the_same_column_changes_nothing() {
    let (_dir, store) = board_store();
    let original = store.add_card("a", "", t(1)).unwrap();
    let (card, changed) = store.move_card(1, Column::Todo, t(2)).unwrap();
    assert!(!changed);
    assert_eq!(card, original);
    assert_eq!(card.transitions.len(), 1);
}

#[test]
fn move_to_todo_or_done_resets_run_state_and_reason() {
    let (_dir, store) = board_store();
    for column in [Column::Todo, Column::Done] {
        let id = store.add_card("a", "", t(1)).unwrap().id;
        store.move_card(id, Column::Doing, t(2)).unwrap();
        store
            .set_run_state(id, RunState::Pending, Some("waiting"), t(3))
            .unwrap();
        let (card, changed) = store.move_card(id, column, t(4)).unwrap();
        assert!(changed);
        assert_eq!(card.run_state, RunState::Idle, "{column:?}");
        assert_eq!(card.pending_reason, None);
        assert_eq!(card.run_state_changed_at, t(4));
        assert_eq!(card.updated_at, t(4));

        let id = store.add_card("b", "", t(5)).unwrap().id;
        store.move_card(id, Column::Doing, t(6)).unwrap();
        store
            .set_run_state(id, RunState::Running, None, t(7))
            .unwrap();
        let (card, _) = store.move_card(id, column, t(8)).unwrap();
        assert_eq!(card.run_state, RunState::Idle);
    }
}

#[test]
fn moving_an_idle_card_does_not_touch_run_state_changed_at() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.move_card(1, Column::Doing, t(2)).unwrap();
    let (card, _) = store.move_card(1, Column::Done, t(3)).unwrap();
    assert_eq!(card.run_state_changed_at, t(1));
    assert_eq!(card.updated_at, t(3));
}

#[test]
fn move_to_doing_keeps_the_run_state() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.move_card(1, Column::Doing, t(2)).unwrap();
    store
        .set_run_state(1, RunState::Running, None, t(3))
        .unwrap();
    // moving doing -> doing is a no-op and keeps running
    let (card, changed) = store.move_card(1, Column::Doing, t(4)).unwrap();
    assert!(!changed);
    assert_eq!(card.run_state, RunState::Running);
}

#[test]
fn move_card_missing_card() {
    let (_dir, store) = board_store();
    assert_eq!(
        store.move_card(3, Column::Done, t(1)).map(|_| ()),
        Err(SkanError::CardNotFound { id: 3 })
    );
}

// ---------------------------------------------------------------- run state

fn doing_card(store: &Store) {
    store.add_card("a", "", t(1)).unwrap();
    store.move_card(1, Column::Doing, t(2)).unwrap();
}

#[test]
fn set_run_state_running_and_pending_with_reason() {
    let (_dir, store) = board_store();
    doing_card(&store);
    let (card, changed) = store
        .set_run_state(1, RunState::Running, None, t(3))
        .unwrap();
    assert!(changed);
    assert_eq!(card.run_state, RunState::Running);
    assert_eq!((card.updated_at, card.run_state_changed_at), (t(3), t(3)));
    assert_eq!(card.column, Column::Doing);

    let (card, changed) = store
        .set_run_state(1, RunState::Pending, Some("  waiting for review "), t(4))
        .unwrap();
    assert!(changed);
    assert_eq!(card.run_state, RunState::Pending);
    assert_eq!(card.pending_reason.as_deref(), Some("waiting for review"));
    assert_eq!((card.updated_at, card.run_state_changed_at), (t(4), t(4)));

    let (card, changed) = store
        .set_run_state(1, RunState::Pending, None, t(5))
        .unwrap();
    assert!(changed, "dropping the reason is a change");
    assert_eq!(card.pending_reason, None);
}

#[test]
fn leaving_pending_clears_the_reason() {
    let (_dir, store) = board_store();
    doing_card(&store);
    store
        .set_run_state(1, RunState::Pending, Some("why"), t(3))
        .unwrap();
    let (card, changed) = store
        .set_run_state(1, RunState::Running, None, t(4))
        .unwrap();
    assert!(changed);
    assert_eq!(card.pending_reason, None);
    store
        .set_run_state(1, RunState::Pending, Some("again"), t(5))
        .unwrap();
    let (card, _) = store.set_run_state(1, RunState::Idle, None, t(6)).unwrap();
    assert_eq!(card.pending_reason, None);
    assert_eq!(card.run_state, RunState::Idle);
}

#[test]
fn same_state_and_reason_is_not_a_change() {
    let (_dir, store) = board_store();
    doing_card(&store);
    let (before, _) = store
        .set_run_state(1, RunState::Running, None, t(3))
        .unwrap();
    let (card, changed) = store
        .set_run_state(1, RunState::Running, None, t(4))
        .unwrap();
    assert!(!changed);
    assert_eq!(card, before);

    let (before, _) = store
        .set_run_state(1, RunState::Pending, Some("x"), t(5))
        .unwrap();
    let (card, changed) = store
        .set_run_state(1, RunState::Pending, Some(" x "), t(6))
        .unwrap();
    assert!(!changed);
    assert_eq!(card, before);
    assert_eq!(card.updated_at, t(5));

    // idle -> idle in todo
    store.move_card(1, Column::Todo, t(7)).unwrap();
    let (card, changed) = store.set_run_state(1, RunState::Idle, None, t(8)).unwrap();
    assert!(!changed);
    assert_eq!(card.updated_at, t(7));
}

#[test]
fn changing_only_the_pending_reason_is_a_change() {
    let (_dir, store) = board_store();
    doing_card(&store);
    store
        .set_run_state(1, RunState::Pending, Some("first"), t(3))
        .unwrap();
    let (card, changed) = store
        .set_run_state(1, RunState::Pending, Some("second"), t(4))
        .unwrap();
    assert!(changed);
    assert_eq!(card.pending_reason.as_deref(), Some("second"));
    assert_eq!(card.updated_at, t(4));
    // the state itself did not change, so its timestamp stays
    assert_eq!(card.run_state_changed_at, t(3));
}

#[test]
fn running_or_pending_outside_doing_is_refused_without_changes() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.add_card("b", "", t(1)).unwrap();
    store.move_card(2, Column::Done, t(2)).unwrap();
    let before = store.snapshot().unwrap();
    for (id, column) in [(1, Column::Todo), (2, Column::Done)] {
        for state in [RunState::Running, RunState::Pending] {
            assert_eq!(
                store.set_run_state(id, state, None, t(3)).map(|_| ()),
                Err(SkanError::InvalidStateForColumn { id, state, column })
            );
        }
    }
    assert_eq!(store.snapshot().unwrap(), before);
}

#[test]
fn a_reason_requires_pending() {
    let (_dir, store) = board_store();
    doing_card(&store);
    let before = store.snapshot().unwrap();
    for state in [RunState::Idle, RunState::Running] {
        assert_eq!(
            store.set_run_state(1, state, Some("why"), t(3)).map(|_| ()),
            Err(SkanError::ReasonRequiresPending)
        );
    }
    assert_eq!(store.snapshot().unwrap(), before);
}

#[test]
fn an_invalid_reason_is_refused_without_changes() {
    let (_dir, store) = board_store();
    doing_card(&store);
    let before = store.snapshot().unwrap();
    for reason in ["", "  ", "a\nb", &"a".repeat(101)] {
        let err = store
            .set_run_state(1, RunState::Pending, Some(reason), t(3))
            .unwrap_err();
        assert!(invalid("reason")(&err), "{reason:?}: {err:?}");
    }
    assert_eq!(store.snapshot().unwrap(), before);
}

#[test]
fn set_run_state_missing_card() {
    let (_dir, store) = board_store();
    assert_eq!(
        store
            .set_run_state(9, RunState::Idle, None, t(1))
            .map(|_| ()),
        Err(SkanError::CardNotFound { id: 9 })
    );
}

// ---------------------------------------------------------------- delete

#[test]
fn delete_card_removes_the_card_and_its_transitions_but_never_reuses_the_id() {
    let (dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    store.add_card("b", "", t(1)).unwrap();
    store.move_card(2, Column::Doing, t(2)).unwrap();
    assert_eq!(count(&dir, "transitions"), 3);
    store.delete_card(2).unwrap();
    assert_eq!(count(&dir, "cards"), 1);
    assert_eq!(count(&dir, "transitions"), 1);
    assert_eq!(
        store.card(2).map(|_| ()),
        Err(SkanError::CardNotFound { id: 2 })
    );
    let c = store.add_card("c", "", t(3)).unwrap();
    assert_eq!(c.id, 3);
    assert_eq!(store.board().unwrap().unwrap().next_card_id, 4);
}

#[test]
fn delete_card_missing_card() {
    let (_dir, store) = board_store();
    assert_eq!(store.delete_card(5), Err(SkanError::CardNotFound { id: 5 }));
    store.add_card("a", "", t(1)).unwrap();
    store.delete_card(1).unwrap();
    assert_eq!(store.delete_card(1), Err(SkanError::CardNotFound { id: 1 }));
}

#[test]
fn card_lookup_of_missing_ids() {
    let (_dir, store) = board_store();
    for id in [0, -1, 1, 100] {
        assert_eq!(
            store.card(id).map(|_| ()),
            Err(SkanError::CardNotFound { id })
        );
    }
}

// ---------------------------------------------------------------- list

fn populate_for_listing(store: &Store) {
    for title in ["t1", "t2", "t3", "t4", "t5", "t6"] {
        store.add_card(title, "", t(1)).unwrap();
    }
    // todo: 1, 2   doing: 4 (running), 3 (pending)   done: 5 then 6
    store.move_card(4, Column::Doing, t(2)).unwrap();
    store.move_card(3, Column::Doing, t(3)).unwrap();
    store
        .set_run_state(4, RunState::Running, None, t(4))
        .unwrap();
    store
        .set_run_state(3, RunState::Pending, Some("w"), t(4))
        .unwrap();
    store.move_card(5, Column::Done, t(5)).unwrap();
    store.move_card(6, Column::Done, t(6)).unwrap();
}

fn ids(cards: &[Card]) -> Vec<i64> {
    cards.iter().map(|c| c.id).collect()
}

#[test]
fn list_cards_uses_display_order() {
    let (_dir, store) = board_store();
    populate_for_listing(&store);
    // todo asc, doing asc by position, done desc by position (newest first)
    assert_eq!(
        ids(&store.list_cards(None, None).unwrap()),
        vec![1, 2, 4, 3, 6, 5]
    );
}

#[test]
fn list_cards_filters_by_column_and_state() {
    let (_dir, store) = board_store();
    populate_for_listing(&store);
    assert_eq!(
        ids(&store.list_cards(Some(Column::Todo), None).unwrap()),
        vec![1, 2]
    );
    assert_eq!(
        ids(&store.list_cards(Some(Column::Doing), None).unwrap()),
        vec![4, 3]
    );
    assert_eq!(
        ids(&store.list_cards(Some(Column::Done), None).unwrap()),
        vec![6, 5]
    );
    assert_eq!(
        ids(&store.list_cards(None, Some(RunState::Running)).unwrap()),
        vec![4]
    );
    assert_eq!(
        ids(&store.list_cards(None, Some(RunState::Pending)).unwrap()),
        vec![3]
    );
    assert_eq!(
        ids(&store.list_cards(None, Some(RunState::Idle)).unwrap()),
        vec![1, 2, 6, 5]
    );
    assert_eq!(
        ids(&store
            .list_cards(Some(Column::Doing), Some(RunState::Pending))
            .unwrap()),
        vec![3]
    );
    assert_eq!(
        store
            .list_cards(Some(Column::Todo), Some(RunState::Running))
            .unwrap(),
        vec![]
    );
}

#[test]
fn listed_cards_include_their_transitions() {
    let (_dir, store) = board_store();
    populate_for_listing(&store);
    let cards = store.list_cards(Some(Column::Done), None).unwrap();
    for card in &cards {
        assert_eq!(card.transitions.len(), 2);
        assert_eq!(card.transitions[0].from, None);
        assert_eq!(card.transitions[1].to, Column::Done);
    }
}

#[test]
fn an_empty_board_lists_no_cards() {
    let (_dir, store) = board_store();
    assert_eq!(store.list_cards(None, None).unwrap(), vec![]);
}

// ---------------------------------------------------------------- snapshot

#[test]
fn snapshot_returns_board_and_all_cards_by_ascending_id() {
    let (_dir, store) = board_store();
    populate_for_listing(&store);
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.board.name, "main");
    assert_eq!(snapshot.board.next_card_id, 7);
    assert_eq!(ids(&snapshot.cards), vec![1, 2, 3, 4, 5, 6]);
    assert_eq!(snapshot.cards[2], store.card(3).unwrap());
}

#[test]
fn replace_all_round_trips_a_snapshot_into_another_store() {
    let (_dir, source) = board_store();
    populate_for_listing(&source);
    source.delete_card(2).unwrap();
    let snapshot = source.snapshot().unwrap();

    let (_dir2, target) = open_store();
    target.replace_all(&snapshot).unwrap();
    assert_eq!(target.snapshot().unwrap(), snapshot);
    assert_eq!(
        ids(&target.list_cards(None, None).unwrap()),
        vec![1, 4, 3, 6, 5]
    );
    // the restored next_card_id is honored: IDs are not reused
    assert_eq!(target.add_card("new", "", t(30)).unwrap().id, 7);
}

#[test]
fn replace_all_replaces_existing_data_entirely() {
    let (dir, store) = board_store();
    populate_for_listing(&store);
    let (_dir2, other) = board_store();
    other.reset_board("other", t(20)).unwrap();
    other.add_card("only", "d", t(21)).unwrap();
    let snapshot = other.snapshot().unwrap();

    store.replace_all(&snapshot).unwrap();
    assert_eq!(store.snapshot().unwrap(), snapshot);
    assert_eq!(count(&dir, "cards"), 1);
    assert_eq!(count(&dir, "transitions"), 1);
}

#[test]
fn replace_all_is_all_or_nothing() {
    let (_dir, store) = board_store();
    populate_for_listing(&store);
    let before = store.snapshot().unwrap();

    // two cards in the same column with the same position violate the schema
    let mut broken = before.clone();
    broken.cards.truncate(2);
    broken.cards[1].column = broken.cards[0].column;
    broken.cards[1].position = broken.cards[0].position;
    let err = store.replace_all(&broken).unwrap_err();
    assert!(matches!(err, SkanError::DatabaseError { .. }), "{err:?}");
    assert_eq!(store.snapshot().unwrap(), before);
}

#[test]
fn replace_all_of_an_empty_board() {
    let (_dir, store) = board_store();
    store.add_card("a", "", t(1)).unwrap();
    let (_d, empty_store) = open_store();
    empty_store.create_board("empty", t(9)).unwrap();
    let snapshot: BoardSnapshot = empty_store.snapshot().unwrap();
    store.replace_all(&snapshot).unwrap();
    assert_eq!(store.snapshot().unwrap(), snapshot);
    assert_eq!(store.list_cards(None, None).unwrap(), vec![]);
}

#[test]
fn data_survives_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    {
        let store = Store::open(&path).unwrap();
        store.create_board("main", t(0)).unwrap();
        store.add_card("persisted", "", t(1)).unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert_eq!(store.card(1).unwrap().title, "persisted");
}
