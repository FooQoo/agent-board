//! Cards, history, state, positions and revisions of one project never mix
//! with another's, even when both use the same card and history numbers.

use agent_board::domain::{
    Actor, Assignee, BoardSnapshot, ChangeContext, Column, NewCard, ProjectId, RunState,
};
use agent_board::error::SkanError;
use agent_board::store::ProjectStore;
use chrono::{DateTime, Duration, TimeZone, Utc};
use rusqlite::Connection;
use std::path::PathBuf;

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 6, 1, 0, 0).unwrap()
}

fn later(minutes: i64) -> DateTime<Utc> {
    now() + Duration::minutes(minutes)
}

fn ctx(actor: Actor, reason: &str) -> ChangeContext {
    ChangeContext {
        actor,
        reason: reason.into(),
    }
}

fn new_card(title: &str, assignee: Assignee) -> NewCard {
    NewCard {
        title: title.into(),
        description: format!("about {title}"),
        assignee,
        actor: Actor::Human,
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    path: PathBuf,
    store: ProjectStore,
    a: ProjectId,
    b: ProjectId,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = ProjectStore::open(&path).unwrap();
    let a = store.create_project("A", now()).unwrap().id;
    let b = store.create_project("B", now()).unwrap().id;
    Fixture {
        _dir: dir,
        path,
        store,
        a,
        b,
    }
}

fn raw(f: &Fixture) -> Connection {
    let conn = Connection::open(&f.path).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    conn
}

/// Give both projects card #1 and #2 with different content and drive B's
/// first card into a pending request, so B has every kind of history.
fn populate(f: &Fixture) {
    for (project, prefix) in [(&f.a, "a"), (&f.b, "b")] {
        f.store
            .add_work_card(
                project,
                new_card(&format!("{prefix}-one"), Assignee::Ai),
                now(),
            )
            .unwrap();
        f.store
            .add_work_card(
                project,
                new_card(&format!("{prefix}-two"), Assignee::Human),
                later(1),
            )
            .unwrap();
    }
    f.store
        .move_work_card(&f.b, 1, Column::Doing, ctx(Actor::Ai, "start b"), later(2))
        .unwrap();
    f.store
        .set_agent_status(
            &f.b,
            1,
            RunState::Pending,
            ctx(Actor::Ai, "which one?"),
            None,
            later(3),
        )
        .unwrap();
}

fn assert_unchanged(f: &Fixture, project: &ProjectId, before: &BoardSnapshot) {
    assert_eq!(&f.store.snapshot(project).unwrap(), before);
}

#[test]
fn both_projects_get_the_same_numbers_without_mixing() {
    let f = fixture();
    populate(&f);
    let a = f.store.snapshot(&f.a).unwrap();
    let b = f.store.snapshot(&f.b).unwrap();

    let ids = |s: &BoardSnapshot| s.cards.iter().map(|c| c.id).collect::<Vec<_>>();
    assert_eq!(ids(&a), vec![1, 2]);
    assert_eq!(ids(&b), vec![1, 2]);
    assert_eq!(a.cards[0].title, "a-one");
    assert_eq!(b.cards[0].title, "b-one");
    assert_eq!(
        a.cards[0].history.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![1]
    );
    assert_eq!(
        a.cards[1].history.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![2]
    );
    // B: created 1, created 2, lane 3, agent 4 (history numbers are per project).
    assert_eq!(
        b.cards[0].history.iter().map(|h| h.id).collect::<Vec<_>>(),
        vec![1, 3, 4]
    );
    assert_eq!(b.cards[1].history[0].id, 2);

    // Lane positions are per project too.
    assert_eq!(a.cards[0].position, 1);
    assert_eq!(a.cards[1].position, 2);
    assert_eq!(b.cards[0].card_status, Column::Doing);
    assert_eq!(b.cards[0].position, 1);
    // Positions are not compacted when a card leaves the lane.
    assert_eq!(b.cards[1].position, 2);

    assert_eq!(a.revision, 2);
    assert_eq!(b.revision, 4);
    assert_eq!(a.cursor.to_string(), format!("{}:2", f.a));
    assert_eq!(b.cursor.to_string(), format!("{}:4", f.b));
    assert_eq!(a.project.id, f.a);
    assert_eq!(a.board.name, "A");
    assert_eq!(a.board.next_card_id, 3);
}

#[test]
fn a_change_to_a_never_changes_the_whole_snapshot_of_b() {
    let f = fixture();
    populate(&f);
    let before_b = f.store.snapshot(&f.b).unwrap();

    f.store
        .edit_card(&f.a, 1, Some("renamed"), Some("new text"), later(10))
        .unwrap();
    assert_unchanged(&f, &f.b, &before_b);

    f.store
        .move_work_card(&f.a, 1, Column::Doing, ctx(Actor::Ai, "go"), later(11))
        .unwrap();
    f.store
        .set_agent_status(
            &f.a,
            1,
            RunState::Running,
            ctx(Actor::Ai, "busy"),
            None,
            later(12),
        )
        .unwrap();
    assert_unchanged(&f, &f.b, &before_b);

    f.store
        .set_agent_status(
            &f.a,
            1,
            RunState::Pending,
            ctx(Actor::Ai, "ask"),
            None,
            later(13),
        )
        .unwrap();
    let request = f.store.card(&f.a, 1).unwrap().pending_request_id.unwrap();
    assert_unchanged(&f, &f.b, &before_b);

    // A request ID of A cannot answer B's pending card with the same number.
    let wrong = f
        .store
        .answer_request(&f.b, 1, &request, ctx(Actor::Human, "no"), later(14))
        .unwrap_err();
    assert_eq!(wrong, SkanError::RequestChanged);
    f.store
        .answer_request(&f.a, 1, &request, ctx(Actor::Human, "yes"), later(15))
        .unwrap();
    assert_unchanged(&f, &f.b, &before_b);

    f.store.delete_card(&f.a, 1).unwrap();
    f.store.reset_project(&f.a).unwrap();
    assert_unchanged(&f, &f.b, &before_b);
    assert!(f.store.snapshot(&f.a).unwrap().cards.is_empty());
}

#[test]
fn a_change_to_b_leaves_a_untouched() {
    let f = fixture();
    populate(&f);
    let before_a = f.store.snapshot(&f.a).unwrap();
    f.store
        .move_work_card(&f.b, 2, Column::Done, ctx(Actor::Human, "done"), later(20))
        .unwrap();
    f.store.delete_card(&f.b, 1).unwrap();
    assert_unchanged(&f, &f.a, &before_a);
}

#[test]
fn a_missing_project_and_a_missing_card_are_told_apart() {
    let f = fixture();
    populate(&f);
    f.store
        .add_work_card(&f.b, new_card("only in b", Assignee::Ai), later(30))
        .unwrap();
    let ghost = ProjectId::generate().unwrap();

    macro_rules! project_missing {
        ($e:expr) => {
            assert!(
                matches!($e, Err(SkanError::ProjectNotFound { .. })),
                "{}",
                stringify!($e)
            )
        };
    }
    project_missing!(f.store.card(&ghost, 1));
    project_missing!(f.store.snapshot(&ghost));
    project_missing!(
        f.store
            .add_work_card(&ghost, new_card("x", Assignee::Ai), now())
    );
    project_missing!(f.store.edit_card(&ghost, 1, Some("x"), None, now()));
    project_missing!(f.store.delete_card(&ghost, 1));
    project_missing!(
        f.store
            .move_work_card(&ghost, 1, Column::Doing, ctx(Actor::Ai, "r"), now())
    );
    project_missing!(f.store.set_agent_status(
        &ghost,
        1,
        RunState::Running,
        ctx(Actor::Ai, "r"),
        None,
        now()
    ));
    project_missing!(
        f.store
            .answer_request(&ghost, 1, "x", ctx(Actor::Ai, "r"), now())
    );
    project_missing!(f.store.reset_project(&ghost));

    // Card #3 exists only in B: A cannot read, change or delete it.
    assert_eq!(f.store.card(&f.b, 3).unwrap().title, "only in b");
    macro_rules! card_missing {
        ($e:expr) => {
            assert_eq!($e.unwrap_err(), SkanError::CardNotFound { id: 3 })
        };
    }
    card_missing!(f.store.card(&f.a, 3));
    card_missing!(f.store.edit_card(&f.a, 3, Some("x"), None, now()));
    card_missing!(f.store.delete_card(&f.a, 3));
    card_missing!(
        f.store
            .move_work_card(&f.a, 3, Column::Doing, ctx(Actor::Ai, "r"), now())
    );
    card_missing!(f.store.set_agent_status(
        &f.a,
        3,
        RunState::Running,
        ctx(Actor::Ai, "r"),
        None,
        now()
    ));
    card_missing!(
        f.store
            .answer_request(&f.a, 3, "x", ctx(Actor::Ai, "r"), now())
    );
    assert_eq!(f.store.card(&f.b, 3).unwrap().title, "only in b");
}

#[test]
fn the_schema_refuses_history_that_points_at_another_projects_card() {
    let f = fixture();
    populate(&f);
    let conn = raw(&f);
    // B's card 2 exists; a history row for project A may not reference card 2
    // unless A has it. A has card 2, so use a card only B has.
    f.store
        .add_work_card(&f.b, new_card("only b", Assignee::Ai), later(5))
        .unwrap();
    let error = conn
        .execute(
            "INSERT INTO history (project_id, id, card_id, kind, actor, to_column, to_agent_status, at)
             VALUES (?1, 99, 3, 'created', 'ai', 'todo', 'idle', '2026-10-06T01:00:00Z')",
            [f.a.as_str()],
        )
        .unwrap_err();
    assert!(error.to_string().contains("FOREIGN KEY"), "{error}");
}

#[test]
fn the_state_rules_hold_in_every_project() {
    let f = fixture();
    populate(&f);
    for project in [&f.a, &f.b] {
        // Human cards cannot run; the AI card must be in Doing first.
        assert_eq!(
            f.store
                .set_agent_status(
                    project,
                    2,
                    RunState::Running,
                    ctx(Actor::Ai, "x"),
                    None,
                    later(40)
                )
                .unwrap_err(),
            SkanError::InvalidStateForAssignee
        );
        assert!(matches!(
            f.store
                .move_work_card(project, 2, Column::Doing, ctx(Actor::Ai, "   "), later(40))
                .unwrap_err(),
            SkanError::InvalidValue { .. }
        ));
    }
    // A: card 1 is AI in Todo, so running is rejected there.
    assert!(
        f.store
            .set_agent_status(
                &f.a,
                1,
                RunState::Running,
                ctx(Actor::Ai, "x"),
                None,
                later(41)
            )
            .is_err()
    );
}

#[test]
fn a_repeated_state_or_lane_changes_nothing_in_either_project() {
    let f = fixture();
    populate(&f);
    let before_a = f.store.snapshot(&f.a).unwrap();
    let before_b = f.store.snapshot(&f.b).unwrap();

    let same_lane = f
        .store
        .move_work_card(&f.a, 1, Column::Todo, ctx(Actor::Ai, "stay"), later(50))
        .unwrap();
    assert!(!same_lane.changed);
    let same_state = f
        .store
        .set_agent_status(
            &f.b,
            1,
            RunState::Pending,
            ctx(Actor::Ai, "other reason"),
            None,
            later(51),
        )
        .unwrap();
    assert!(!same_state.changed);
    let same_edit = f
        .store
        .edit_card(&f.a, 1, Some("a-one"), Some("about a-one"), later(52))
        .unwrap();
    assert!(!same_edit.changed);

    assert_unchanged(&f, &f.a, &before_a);
    assert_unchanged(&f, &f.b, &before_b);
}

#[test]
fn lanes_keep_their_order_per_project() {
    let f = fixture();
    populate(&f);
    f.store
        .move_work_card(&f.a, 2, Column::Doing, ctx(Actor::Human, "x"), later(60))
        .unwrap();
    f.store
        .move_work_card(&f.a, 1, Column::Doing, ctx(Actor::Human, "y"), later(61))
        .unwrap();
    let a = f.store.snapshot(&f.a).unwrap();
    let pos = |id: i64| a.cards.iter().find(|c| c.id == id).unwrap().position;
    assert_eq!((pos(2), pos(1)), (1, 2));
    // B's Doing lane still has its own first position.
    let b = f.store.snapshot(&f.b).unwrap();
    assert_eq!(b.cards.iter().find(|c| c.id == 1).unwrap().position, 1);
}

#[test]
fn the_move_updates_times_only_when_the_state_really_changes() {
    let f = fixture();
    populate(&f);
    let b1 = f.store.card(&f.b, 1).unwrap();
    assert_eq!(b1.agent_status_changed_at, later(3));
    // Moving a pending card resets the state and its time.
    let moved = f
        .store
        .move_work_card(
            &f.b,
            1,
            Column::Done,
            ctx(Actor::Human, "finish"),
            later(70),
        )
        .unwrap()
        .value;
    assert_eq!(moved.agent_status, RunState::Idle);
    assert_eq!(moved.agent_status_changed_at, later(70));
    assert_eq!(moved.pending_request_id, None);
    // A idle card keeps its state time.
    let a2 = f.store.card(&f.a, 2).unwrap();
    let moved = f
        .store
        .move_work_card(
            &f.a,
            2,
            Column::Done,
            ctx(Actor::Human, "finish"),
            later(71),
        )
        .unwrap()
        .value;
    assert_eq!(moved.agent_status_changed_at, a2.agent_status_changed_at);
    assert_eq!(moved.updated_at, later(71));
}

#[test]
fn delete_removes_one_projects_card_and_its_history_only() {
    let f = fixture();
    populate(&f);
    f.store.delete_card(&f.a, 1).unwrap();
    let conn = raw(&f);
    let count = |sql: &str, project: &ProjectId| -> i64 {
        conn.query_row(sql, [project.as_str()], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(
        count("SELECT COUNT(*) FROM cards WHERE project_id=?1", &f.a),
        1
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM history WHERE project_id=?1", &f.a),
        1
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM cards WHERE project_id=?1", &f.b),
        2
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM history WHERE project_id=?1", &f.b),
        4
    );
    // A deleted number is not reused.
    let card = f
        .store
        .add_work_card(&f.a, new_card("next", Assignee::Ai), later(80))
        .unwrap();
    assert_eq!(card.id, 3);
}

#[test]
fn reset_keeps_identity_and_counters_and_changes_the_revision_only_when_needed() {
    let f = fixture();
    populate(&f);
    let before_b = f.store.snapshot(&f.b).unwrap();
    let project = f.store.project(&f.a).unwrap();
    let counters = f.store.counters(&f.a).unwrap();

    let reset = f.store.reset_project(&f.a).unwrap();
    assert!(reset.changed);
    assert_eq!(reset.value.name, "A");
    assert_eq!(reset.value.next_card_id, counters.next_card_id);

    let after = f.store.counters(&f.a).unwrap();
    assert_eq!(after.revision, counters.revision + 1);
    assert_eq!(after.next_card_id, counters.next_card_id);
    assert_eq!(after.next_history_id, counters.next_history_id);
    assert_eq!(f.store.project(&f.a).unwrap(), project);
    assert!(f.store.snapshot(&f.a).unwrap().cards.is_empty());
    assert_unchanged(&f, &f.b, &before_b);

    // Already empty: no change, no revision.
    let again = f.store.reset_project(&f.a).unwrap();
    assert!(!again.changed);
    assert_eq!(f.store.counters(&f.a).unwrap(), after);

    // Numbers continue after a reset.
    let card = f
        .store
        .add_work_card(&f.a, new_card("fresh", Assignee::Ai), later(90))
        .unwrap();
    assert_eq!(card.id, 3);
    assert_eq!(card.history[0].id, 3);
}

#[test]
fn a_deleted_project_is_gone_for_every_operation_and_never_reappears_by_name() {
    let f = fixture();
    populate(&f);
    f.store.delete_project(&f.a).unwrap();
    assert!(matches!(
        f.store.card(&f.a, 1),
        Err(SkanError::ProjectNotFound { .. })
    ));
    let again = f.store.create_project("A", later(100)).unwrap();
    assert_ne!(again.id, f.a);
    assert!(matches!(
        f.store.card(&f.a, 1),
        Err(SkanError::ProjectNotFound { .. })
    ));
    assert!(f.store.snapshot(&again.id).unwrap().cards.is_empty());
}

#[test]
fn counters_and_revision_overflow_leave_nothing_behind() {
    let f = fixture();
    populate(&f);
    let conn = raw(&f);
    let set = |column: &str, value: i64| {
        conn.execute(
            &format!("UPDATE projects SET {column} = ?1 WHERE id = ?2"),
            rusqlite::params![value, f.a.as_str()],
        )
        .unwrap();
    };
    let before_b = f.store.snapshot(&f.b).unwrap();

    for column in ["next_card_id", "next_history_id", "revision"] {
        let original: i64 = conn
            .query_row(
                &format!("SELECT {column} FROM projects WHERE id = ?1"),
                [f.a.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        set(column, i64::MAX);
        let before = f.store.snapshot(&f.a).unwrap();
        assert!(
            matches!(
                f.store
                    .add_work_card(&f.a, new_card("x", Assignee::Ai), later(110)),
                Err(SkanError::DatabaseError { .. })
            ),
            "add with {column} at the limit"
        );
        assert_eq!(f.store.snapshot(&f.a).unwrap(), before, "{column}");
        assert_eq!(
            f.store.card(&f.a, 3).unwrap_err(),
            SkanError::CardNotFound { id: 3 }
        );
        set(column, original);
    }

    // A lane position at the limit.
    conn.execute(
        "UPDATE cards SET position = ?1 WHERE project_id = ?2 AND id = 2",
        rusqlite::params![i64::MAX, f.a.as_str()],
    )
    .unwrap();
    let before = f.store.snapshot(&f.a).unwrap();
    assert!(matches!(
        f.store
            .add_work_card(&f.a, new_card("x", Assignee::Ai), later(111)),
        Err(SkanError::DatabaseError { .. })
    ));
    assert_eq!(f.store.snapshot(&f.a).unwrap(), before);
    assert_unchanged(&f, &f.b, &before_b);
}
