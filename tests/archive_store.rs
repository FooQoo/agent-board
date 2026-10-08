use agent_board::{
    domain::{Actor, Assignee, Column, NewCard, RunState},
    error::SkanError,
    store::ProjectStore,
};
use chrono::{TimeZone, Utc};
use tempfile::tempdir;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 0, 0, 0).unwrap()
}

#[test]
fn archive_preserves_card_and_restore_appends_to_lane() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let project = store.create_project("Archive", now()).unwrap().id;
    let first = store
        .add_work_card(
            &project,
            NewCard {
                title: "first".into(),
                description: "body".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
            },
            now(),
        )
        .unwrap();
    let second = store
        .add_work_card(
            &project,
            NewCard {
                title: "second".into(),
                description: "".into(),
                assignee: Assignee::Human,
                actor: Actor::Human,
            },
            now(),
        )
        .unwrap();
    let archived = store.archive_card(&project, first.id, now()).unwrap();
    assert!(archived.changed);
    assert_eq!(archived.value.archived_at, Some(now()));
    assert_eq!(archived.value.description, "body");
    assert_eq!(
        store
            .snapshot(&project)
            .unwrap()
            .cards
            .iter()
            .map(|c| c.id)
            .collect::<Vec<_>>(),
        vec![second.id]
    );
    let restored = store
        .restore_card(&project, first.id, now() + chrono::Duration::seconds(1))
        .unwrap();
    assert!(restored.changed);
    assert!(restored.value.archived_at.is_none());
    assert_eq!(restored.value.position, 3);
    assert_eq!(
        restored.value.history.last().unwrap().kind,
        agent_board::domain::HistoryKind::Restore
    );
}

#[test]
fn archived_writes_are_rejected_and_delete_cascades() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let store = ProjectStore::open(&path).unwrap();
    let project = store.create_project("Archive", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
            NewCard {
                title: "done".into(),
                description: "".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
            },
            now(),
        )
        .unwrap();
    store
        .move_work_card_for_user(
            &project,
            card.id,
            Column::Done,
            agent_board::domain::ChangeContext {
                actor: Actor::Human,
                reason: "done".into(),
            },
            now(),
        )
        .unwrap();
    store.archive_card(&project, card.id, now()).unwrap();
    assert!(matches!(
        store.set_agent_status(
            &project,
            card.id,
            RunState::Idle,
            agent_board::domain::ChangeContext {
                actor: Actor::Ai,
                reason: "x".into()
            },
            None,
            now()
        ),
        Err(SkanError::CardArchived { .. })
    ));
    assert!(matches!(
        store.delete_archived_card(&project, card.id),
        Ok(())
    ));
    assert!(matches!(
        store.card(&project, card.id),
        Err(SkanError::CardNotFound { .. })
    ));
}

#[test]
fn bulk_archive_is_atomic_and_rejects_invalid_targets() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let project = store.create_project("Archive", now()).unwrap().id;
    let card = store
        .add_work_card(
            &project,
            NewCard {
                title: "todo".into(),
                description: "".into(),
                assignee: Assignee::Human,
                actor: Actor::Human,
            },
            now(),
        )
        .unwrap();
    assert!(matches!(
        store.archive_done(&project, &[card.id], now()),
        Err(SkanError::ArchiveTargetsChanged)
    ));
    assert_eq!(store.snapshot(&project).unwrap().cards.len(), 1);
    assert!(matches!(
        store.archive_done(&project, &[], now()),
        Err(SkanError::InvalidValue { .. })
    ));
}
