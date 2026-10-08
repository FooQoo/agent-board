use agent_board::{
    domain::{Actor, Assignee, ChangeContext, Column, NewCard, RunState},
    store::ProjectStore,
};
use chrono::{TimeZone, Utc};
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
    let store = ProjectStore::open(&path).unwrap();
    let project = store.create_project("Agent Board", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
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
    assert_eq!(store.snapshot(&project).unwrap().revision, 1);
    let moved = store
        .move_work_card(
            &project,
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
            &project,
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
            &project,
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
                &project,
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
            &project,
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
    assert_eq!(store.snapshot(&project).unwrap().revision, 5);
}

#[test]
fn invalid_assignee_and_stale_request_leave_state_unchanged() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let project = store.create_project("Agent Board", now()).unwrap().id;
    let user = store
        .add_work_card(
            &project,
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
                &project,
                user.id,
                RunState::Running,
                context(Actor::Human, "work"),
                None,
                now()
            )
            .is_err()
    );
    assert_eq!(store.snapshot(&project).unwrap().revision, 1);
    assert!(
        store
            .answer_request(
                &project,
                user.id,
                "stale",
                context(Actor::Human, "answer"),
                now()
            )
            .is_err()
    );
    assert_eq!(store.snapshot(&project).unwrap().revision, 1);
}

#[test]
fn read_only_open_does_not_create_missing_database() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("missing.db");
    assert!(ProjectStore::open_read_only(&path).is_err());
    assert!(!path.exists());
}

#[test]
fn history_failure_rolls_back_state_timestamp_and_revision() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = ProjectStore::open(&path).unwrap();
    let project = store.create_project("Agent Board", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
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
        .move_work_card(
            &project,
            card.id,
            Column::Doing,
            context(Actor::Ai, "Start"),
            now(),
        )
        .unwrap();
    let before = store.snapshot(&project).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_history BEFORE INSERT ON history WHEN NEW.kind='agent' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(
        store
            .set_agent_status(
                &project,
                card.id,
                RunState::Running,
                context(Actor::Ai, "Run"),
                None,
                now()
            )
            .is_err()
    );
    let after = store.snapshot(&project).unwrap();
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.cards[0].agent_status, RunState::Idle);
    assert_eq!(after.cards[0].updated_at, before.cards[0].updated_at);
    assert_eq!(after.cards[0].history, before.cards[0].history);
}

#[test]
fn setting_the_same_agent_state_is_a_revision_preserving_noop() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let project = store.create_project("Agent Board", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
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
        .move_work_card(
            &project,
            card.id,
            Column::Doing,
            context(Actor::Ai, "Start"),
            now(),
        )
        .unwrap();
    let before = store.snapshot(&project).unwrap();
    let result = store
        .set_agent_status(
            &project,
            card.id,
            RunState::Idle,
            context(Actor::Ai, "No change"),
            None,
            now(),
        )
        .unwrap();
    let after = store.snapshot(&project).unwrap();
    assert!(!result.changed);
    assert_eq!(before.revision, after.revision);
    assert_eq!(before.cards[0].history, after.cards[0].history);
}

#[test]
fn moving_a_running_card_to_done_records_one_lane_event_and_resets_idle() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let project = store.create_project("Agent Board", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
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
        .move_work_card(
            &project,
            card.id,
            Column::Doing,
            context(Actor::Ai, "Start"),
            now(),
        )
        .unwrap();
    store
        .set_agent_status(
            &project,
            card.id,
            RunState::Running,
            context(Actor::Ai, "Working"),
            None,
            now(),
        )
        .unwrap();
    let done = store
        .move_work_card(
            &project,
            card.id,
            Column::Done,
            context(Actor::Human, "Reviewed and complete"),
            now(),
        )
        .unwrap();
    assert_eq!(done.value.agent_status, RunState::Idle);
    assert_eq!(done.value.history.len(), 4);
    let event = done.value.history.last().unwrap();
    assert_eq!(event.kind, agent_board::domain::HistoryKind::Lane);
    assert_eq!(event.from_agent_status, Some(RunState::Running));
    assert_eq!(event.to_agent_status, RunState::Idle);
}

mod drafts {
    use super::*;
    use agent_board::domain::ProjectId;
    use agent_board::error::SkanError;

    fn later(minutes: i64) -> chrono::DateTime<Utc> {
        now() + chrono::Duration::minutes(minutes)
    }

    fn new_card(title: &str) -> NewCard {
        NewCard {
            title: title.into(),
            description: String::new(),
            assignee: Assignee::Ai,
            actor: Actor::Ai,
        }
    }

    fn setup() -> (tempfile::TempDir, ProjectStore, ProjectId) {
        let dir = tempdir().unwrap();
        let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
        let project = store.create_project("Drafts", now()).unwrap().id;
        store
            .add_work_card(&project, new_card("one"), now())
            .unwrap();
        store
            .add_work_card(&project, new_card("two"), later(1))
            .unwrap();
        (dir, store, project)
    }

    #[test]
    fn descriptions_up_to_fifty_thousand_characters_are_stored() {
        let (_dir, store, project) = setup();
        let long = "あ".repeat(50_000);
        let edited = store
            .edit_card(&project, 1, None, Some(&long), later(2))
            .unwrap();
        assert_eq!(edited.value.description.chars().count(), 50_000);
        let before = store.snapshot(&project).unwrap();
        let err = store
            .edit_card(&project, 1, None, Some(&"あ".repeat(50_001)), later(3))
            .unwrap_err();
        assert!(matches!(err, SkanError::InvalidValue { .. }));
        assert_eq!(store.snapshot(&project).unwrap(), before);
    }

    #[test]
    fn a_new_card_is_not_a_draft_and_json_carries_is_draft() {
        let (_dir, store, project) = setup();
        let card = store.card(&project, 1).unwrap();
        assert!(!card.is_draft);
        assert_eq!(serde_json::to_value(&card).unwrap()["isDraft"], false);
    }

    #[test]
    fn set_draft_toggles_bumps_only_the_revision_and_is_idempotent() {
        let (_dir, store, project) = setup();
        let before = store.snapshot(&project).unwrap();
        let drafted = store.set_draft(&project, 1, true).unwrap();
        assert!(drafted.changed);
        assert!(drafted.value.is_draft);
        let after = store.snapshot(&project).unwrap();
        assert_eq!(after.revision, before.revision + 1);
        assert_eq!(drafted.value.updated_at, before.cards[0].updated_at);
        assert_eq!(
            drafted.value.agent_status_changed_at,
            before.cards[0].agent_status_changed_at
        );
        assert_eq!(drafted.value.history, before.cards[0].history);
        // the other card is untouched
        assert_eq!(after.cards[1], before.cards[1]);

        let same = store.set_draft(&project, 1, true).unwrap();
        assert!(!same.changed);
        assert_eq!(store.snapshot(&project).unwrap().revision, after.revision);

        let back = store.set_draft(&project, 1, false).unwrap();
        assert!(back.changed);
        assert!(!back.value.is_draft);
        assert_eq!(back.value.updated_at, before.cards[0].updated_at);
        assert_eq!(
            store.snapshot(&project).unwrap().revision,
            after.revision + 1
        );
        let same = store.set_draft(&project, 1, false).unwrap();
        assert!(!same.changed);
    }

    #[test]
    fn set_draft_fails_for_missing_cards() {
        let (_dir, store, project) = setup();
        assert_eq!(
            store.set_draft(&project, 9, true).unwrap_err(),
            SkanError::CardNotFound { id: 9 }
        );
    }

    #[test]
    fn running_cards_cannot_become_drafts_but_pending_cards_can() {
        let (_dir, store, project) = setup();
        store
            .move_work_card(
                &project,
                1,
                Column::Doing,
                context(Actor::Ai, "go"),
                later(2),
            )
            .unwrap();
        store
            .set_agent_status(
                &project,
                1,
                RunState::Running,
                context(Actor::Ai, "work"),
                None,
                later(3),
            )
            .unwrap();
        let before = store.snapshot(&project).unwrap();
        assert_eq!(
            store.set_draft(&project, 1, true).unwrap_err(),
            SkanError::InvalidStateForDraft {
                id: 1,
                state: RunState::Running
            }
        );
        store
            .set_agent_status(
                &project,
                1,
                RunState::Pending,
                context(Actor::Ai, "ask"),
                None,
                later(4),
            )
            .unwrap();
        let before_pending = store.snapshot(&project).unwrap();
        assert!(before.revision < before_pending.revision);
        let pending_draft = store.set_draft(&project, 1, true).unwrap();
        assert!(pending_draft.changed);
        assert!(pending_draft.value.is_draft);
        assert_eq!(pending_draft.value.agent_status, RunState::Pending);
        let after_pending_draft = store.snapshot(&project).unwrap();
        assert!(before_pending.revision < after_pending_draft.revision);
    }

    #[test]
    fn a_draft_blocks_agent_writes_without_changing_anything() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 1, true).unwrap();
        let before = store.snapshot(&project).unwrap();
        let blocked = SkanError::CardIsDraft { id: 1 };
        assert_eq!(
            store
                .edit_card(&project, 1, Some("new"), None, later(5))
                .unwrap_err(),
            blocked
        );
        assert_eq!(
            store
                .move_work_card(
                    &project,
                    1,
                    Column::Doing,
                    context(Actor::Ai, "go"),
                    later(5)
                )
                .unwrap_err(),
            blocked
        );
        // same-lane moves and unchanged edits are blocked too, whoever the actor is
        assert_eq!(
            store
                .move_work_card(
                    &project,
                    1,
                    Column::Todo,
                    context(Actor::Human, "stay"),
                    later(5)
                )
                .unwrap_err(),
            blocked
        );
        assert_eq!(
            store
                .set_agent_status(
                    &project,
                    1,
                    RunState::Idle,
                    context(Actor::Human, "x"),
                    None,
                    later(5)
                )
                .unwrap_err(),
            blocked
        );
        assert_eq!(store.snapshot(&project).unwrap(), before);
    }

    #[test]
    fn user_moves_work_on_drafts_and_other_writes_are_not_blocked() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 1, true).unwrap();
        let moved = store
            .move_work_card_for_user(
                &project,
                1,
                Column::Doing,
                context(Actor::Human, "Start"),
                later(5),
            )
            .unwrap();
        assert!(moved.changed);
        assert!(moved.value.is_draft);
        assert_eq!(moved.value.card_status, Column::Doing);
        assert_eq!(moved.value.history.len(), 2);
        // adding a card and deleting a draft are allowed
        store
            .add_work_card(&project, new_card("three"), later(6))
            .unwrap();
        store.delete_card(&project, 1).unwrap();
        assert!(matches!(
            store.card(&project, 1),
            Err(SkanError::CardNotFound { .. })
        ));
    }

    #[test]
    fn user_move_behaves_like_move_for_non_drafts() {
        let (_dir, store, project) = setup();
        let moved = store
            .move_work_card_for_user(
                &project,
                2,
                Column::Doing,
                context(Actor::Human, "Start"),
                later(5),
            )
            .unwrap();
        assert!(moved.changed);
        let same = store
            .move_work_card_for_user(
                &project,
                2,
                Column::Doing,
                context(Actor::Human, "Start"),
                later(6),
            )
            .unwrap();
        assert!(!same.changed);
    }

    #[test]
    fn finalizing_unblocks_agent_writes_and_drafts_are_per_card_and_project() {
        let (_dir, store, project) = setup();
        let other = store.create_project("Other", later(1)).unwrap().id;
        store
            .add_work_card(&other, new_card("same id"), later(1))
            .unwrap();
        store.set_draft(&project, 1, true).unwrap();
        // card 2 and the other project's card 1 are not drafts
        store
            .edit_card(&project, 2, Some("fine"), None, later(5))
            .unwrap();
        store
            .edit_card(&other, 1, Some("fine"), None, later(5))
            .unwrap();
        store.set_draft(&project, 1, false).unwrap();
        store
            .edit_card(&project, 1, Some("now ok"), None, later(6))
            .unwrap();
    }

    #[test]
    fn answer_request_is_not_blocked_by_the_draft_check() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 2, true).unwrap();
        // answering a request that does not exist still fails as before
        assert_eq!(
            store
                .answer_request(&project, 2, "nope", context(Actor::Human, "a"), later(5))
                .unwrap_err(),
            SkanError::RequestChanged
        );
    }

    #[test]
    fn edit_draft_card_requires_a_draft() {
        let (_dir, store, project) = setup();
        let before = store.snapshot(&project).unwrap();
        assert_eq!(
            store
                .edit_draft_card(&project, 1, Some("x"), None, false, later(5))
                .unwrap_err(),
            SkanError::CardNotDraft { id: 1 }
        );
        assert_eq!(store.snapshot(&project).unwrap(), before);
    }

    #[test]
    fn edit_draft_card_saves_and_finalizes() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 1, true).unwrap();
        let base = store.snapshot(&project).unwrap();

        // title only
        let a = store
            .edit_draft_card(&project, 1, Some("Title"), None, false, later(5))
            .unwrap();
        assert!(a.changed && a.value.is_draft);
        assert_eq!(a.value.title, "Title");
        assert_eq!(a.value.updated_at, later(5));
        assert_eq!(
            store.snapshot(&project).unwrap().revision,
            base.revision + 1
        );

        // description only (CRLF normalized)
        let b = store
            .edit_draft_card(&project, 1, None, Some("a\r\nb"), false, later(6))
            .unwrap();
        assert_eq!(b.value.description, "a\nb");
        assert_eq!(b.value.updated_at, later(6));

        // nothing changes
        let rev = store.snapshot(&project).unwrap().revision;
        let c = store
            .edit_draft_card(&project, 1, Some("Title"), Some("a\nb"), false, later(7))
            .unwrap();
        assert!(!c.changed);
        assert_eq!(c.value.updated_at, later(6));
        assert_eq!(store.snapshot(&project).unwrap().revision, rev);

        // finalize alone: revision +1, updated_at unchanged
        let d = store
            .edit_draft_card(&project, 1, None, None, true, later(8))
            .unwrap();
        assert!(d.changed && !d.value.is_draft);
        assert_eq!(d.value.updated_at, later(6));
        assert_eq!(store.snapshot(&project).unwrap().revision, rev + 1);
        // history untouched by all of this
        assert_eq!(d.value.history, base.cards[0].history);
    }

    #[test]
    fn edit_draft_card_saves_and_finalizes_in_one_step() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 1, true).unwrap();
        let rev = store.snapshot(&project).unwrap().revision;
        let done = store
            .edit_draft_card(&project, 1, Some("T"), Some("body"), true, later(5))
            .unwrap();
        assert!(done.changed && !done.value.is_draft);
        assert_eq!(done.value.title, "T");
        assert_eq!(store.snapshot(&project).unwrap().revision, rev + 1);
    }

    #[test]
    fn a_failed_validation_leaves_the_draft_and_its_text_untouched() {
        let (_dir, store, project) = setup();
        store.set_draft(&project, 1, true).unwrap();
        let before = store.snapshot(&project).unwrap();
        assert!(matches!(
            store.edit_draft_card(
                &project,
                1,
                Some("ok"),
                Some(&"a".repeat(50_001)),
                true,
                later(5)
            ),
            Err(SkanError::InvalidValue { .. })
        ));
        assert!(matches!(
            store.edit_draft_card(&project, 1, Some(""), None, true, later(5)),
            Err(SkanError::InvalidValue { .. })
        ));
        assert_eq!(store.snapshot(&project).unwrap(), before);
    }

    #[test]
    fn a_racing_draft_switch_and_edit_leave_one_consistent_result() {
        for _ in 0..20 {
            let (dir, store, project) = setup();
            let second = ProjectStore::open(&dir.path().join("board.db")).unwrap();
            let p2 = project.clone();
            let handle = std::thread::spawn(move || {
                second.edit_card(&p2, 1, Some("edited"), None, later(9))
            });
            let drafted = store.set_draft(&project, 1, true);
            let edited = handle.join().unwrap();
            drafted.unwrap();
            let card = store.card(&project, 1).unwrap();
            assert!(card.is_draft);
            match edited {
                Ok(_) => assert_eq!(card.title, "edited"),
                Err(SkanError::CardIsDraft { id: 1 }) => assert_eq!(card.title, "one"),
                Err(SkanError::DatabaseBusy) => {}
                Err(other) => panic!("unexpected {other:?}"),
            }
        }
    }
}
