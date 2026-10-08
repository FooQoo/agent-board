use agent_board::{
    domain::{Actor, Assignee, AttachmentInput, NewCard},
    store::ProjectStore,
};
use chrono::{TimeZone, Utc};
use tempfile::tempdir;

fn png() -> Vec<u8> {
    vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]
}

#[test]
fn attachments_are_blob_metadata_only_in_snapshot_and_are_atomic() {
    let dir = tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    let now = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
    let project = store.create_project("Alpha", now).unwrap();
    let card = store
        .add_work_card(
            &project.id,
            NewCard {
                title: "Card".into(),
                description: "before".into(),
                assignee: Assignee::Ai,
                actor: Actor::Human,
            },
            now,
        )
        .unwrap();
    let input = AttachmentInput {
        id: "0123456789abcdef0123456789abcdef".into(),
        name: "x.png".into(),
        bytes: png(),
    };
    let saved = store
        .save_card_attachments(
            &project.id,
            card.id,
            Some("Card 2"),
            Some("after"),
            &[input.clone()],
            &[],
            "request-1",
            now,
        )
        .unwrap();
    assert_eq!(saved.attachments.len(), 1);
    assert!(
        !serde_json::to_string(&store.snapshot(&project.id).unwrap())
            .unwrap()
            .contains("137,80")
    );
    let data = store.attachment(&project.id, card.id, &input.id).unwrap();
    assert_eq!(data.bytes, input.bytes);
    assert_eq!(store.counters(&project.id).unwrap().revision, 2);
    let retry = store
        .save_card_attachments(
            &project.id,
            card.id,
            Some("Card 2"),
            Some("after"),
            &[input],
            &[],
            "request-1",
            now,
        )
        .unwrap();
    assert_eq!(retry.attachments.len(), 1);
    assert_eq!(store.counters(&project.id).unwrap().revision, 2);
}

#[test]
fn old_schema_is_rejected_without_conversion() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("board.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", 4).unwrap();
    drop(conn);
    assert!(matches!(
        ProjectStore::open(&path),
        Err(agent_board::error::SkanError::DatabaseError { .. })
    ));
}
