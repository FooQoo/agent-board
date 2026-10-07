//! Backup export, validation and restore act on the one project they are
//! given, keep numbering and revisions moving forward, and are atomic.

use agent_board::domain::{
    Actor, Assignee, BoardSnapshot, ChangeContext, Column, NewCard, ProjectId, RunState,
    ValidatedBoard,
};
use agent_board::error::SkanError;
use agent_board::store::ProjectStore;
use agent_board::transfer::Backup;
use chrono::{DateTime, Duration, TimeZone, Utc};

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 6, 2, 0, 0).unwrap()
}

fn later(minutes: i64) -> DateTime<Utc> {
    now() + Duration::minutes(minutes)
}

fn ctx(reason: &str) -> ChangeContext {
    ChangeContext {
        actor: Actor::Ai,
        reason: reason.into(),
    }
}

fn card(title: &str) -> NewCard {
    NewCard {
        title: title.into(),
        description: String::new(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    store: ProjectStore,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(&dir.path().join("board.db")).unwrap();
    Fixture { _dir: dir, store }
}

/// A project with two cards, one of them pending a decision.
fn busy_project(store: &ProjectStore, name: &str, at: DateTime<Utc>) -> ProjectId {
    let id = store.create_project(name, at).unwrap().id;
    store.add_work_card(&id, card("first"), at).unwrap();
    store.add_work_card(&id, card("second"), later(1)).unwrap();
    store
        .move_work_card(&id, 1, Column::Doing, ctx("start"), later(2))
        .unwrap();
    store
        .set_agent_status(&id, 1, RunState::Running, ctx("working"), None, later(3))
        .unwrap();
    store
        .set_agent_status(&id, 1, RunState::Pending, ctx("which way?"), None, later(4))
        .unwrap();
    id
}

fn validated(snapshot: BoardSnapshot) -> ValidatedBoard {
    let text = serde_json::to_string_pretty(&Backup::from_snapshot(snapshot)).unwrap();
    serde_json::from_str::<Backup>(&text)
        .unwrap()
        .validate()
        .unwrap()
}

fn backup_of(store: &ProjectStore, id: &ProjectId) -> Backup {
    Backup::from_snapshot(store.snapshot(id).unwrap())
}

#[test]
fn a_backup_holds_only_the_board_and_never_ids_revisions_or_cursors() {
    let f = fixture();
    let id = busy_project(&f.store, "A", now());
    let value = serde_json::to_value(backup_of(&f.store, &id)).unwrap();
    let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["board", "cards", "format", "version"]);
    let mut board: Vec<_> = value["board"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    board.sort();
    assert_eq!(board, ["createdAt", "name", "nextCardId"]);
    let text = value.to_string();
    assert!(
        !text.contains(id.as_str()),
        "the project ID must not be exported"
    );
    assert!(!text.contains("revision") && !text.contains("cursor"));
    assert_eq!(value["version"], 2);
    assert_eq!(value["format"], "skan-board");
}

#[test]
fn exporting_then_importing_as_a_new_project_reproduces_the_board() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let original = f.store.snapshot(&a).unwrap();
    let board = validated(original.clone());
    assert_eq!(board.metadata, original.board);
    assert_eq!(board.cards, original.cards);

    f.store.delete_project(&a).unwrap();
    let created = f.store.create_from_backup("A", &board).unwrap();
    assert_ne!(created.id, a, "a new project gets a new ID");
    assert_eq!(created.name, "A");
    assert_eq!(created.created_at, original.board.created_at);

    let restored = f.store.snapshot(&created.id).unwrap();
    assert_eq!(restored.board, original.board);
    assert_eq!(restored.cards, original.cards);
    assert_eq!(restored.revision, 0);

    // Numbering continues after the highest imported numbers.
    let next = f
        .store
        .add_work_card(&created.id, card("third"), later(10))
        .unwrap();
    assert_eq!(next.id, 3);
    assert_eq!(next.history[0].id, 6);
}

#[test]
fn a_new_project_needs_the_backup_name_and_replaces_nothing() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let b = busy_project(&f.store, "B", later(20));
    let board = validated(f.store.snapshot(&a).unwrap());
    let catalog = f.store.projects().unwrap();
    let before_a = f.store.snapshot(&a).unwrap();
    let before_b = f.store.snapshot(&b).unwrap();

    // The name differs from the backup's.
    let err = f.store.create_from_backup("C", &board).unwrap_err();
    assert!(matches!(err, SkanError::ImportInvalid { .. }), "{err:?}");
    // The name is taken: no implicit replacement.
    let err = f.store.create_from_backup("A", &board).unwrap_err();
    assert_eq!(err, SkanError::ProjectNameExists { name: "A".into() });
    // The name is invalid.
    assert!(f.store.create_from_backup(" ", &board).is_err());

    assert_eq!(f.store.projects().unwrap(), catalog);
    assert_eq!(f.store.snapshot(&a).unwrap(), before_a);
    assert_eq!(f.store.snapshot(&b).unwrap(), before_b);
}

#[test]
fn restoring_an_existing_project_keeps_its_id_and_moves_revision_forward() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let b = busy_project(&f.store, "B", later(30));
    let scratch = busy_project(&f.store, "scratch", later(40));
    let mut backup = backup_of(&f.store, &scratch);
    backup.board.name = "A".into();
    let board = backup.validate().unwrap();

    let before_b = f.store.snapshot(&b).unwrap();
    let revision = f.store.counters(&a).unwrap().revision;
    let catalog = f.store.projects().unwrap();

    // Replace A's cards with the scratch cards while A keeps its own ID.
    let meta = f.store.restore_project(&a, &board).unwrap();
    assert_eq!(meta.id, a);
    let after = f.store.snapshot(&a).unwrap();
    assert_eq!(after.project.id, a);
    assert_eq!(after.cards, board.cards);
    assert_eq!(after.board.created_at, board.metadata.created_at);
    assert_eq!(after.revision, revision + 1);

    // createdAt came from the backup, so the catalog row changed once.
    assert_eq!(
        f.store.projects().unwrap().catalog_revision,
        catalog.catalog_revision + 1
    );
    assert_eq!(f.store.snapshot(&b).unwrap(), before_b);

    // Restoring again with the same data still moves the revision on, and the
    // catalog stays put because name and createdAt are unchanged.
    let catalog = f.store.projects().unwrap();
    f.store.restore_project(&a, &board).unwrap();
    assert_eq!(f.store.snapshot(&a).unwrap().revision, revision + 2);
    assert_eq!(f.store.projects().unwrap(), catalog);
}

#[test]
fn restore_never_lowers_the_numbers_already_handed_out() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    // Hand out more numbers, then delete the cards: the counters stay high.
    for n in 0..5 {
        f.store
            .add_work_card(&a, card(&format!("extra{n}")), later(10 + n))
            .unwrap();
    }
    f.store.reset_project(&a).unwrap();
    let counters = f.store.counters(&a).unwrap();
    assert!(counters.next_card_id >= 8 && counters.next_history_id >= 8);

    // A small backup (cards 1 and 2, histories 1..) restores into A.
    let small = f.store.create_project("small", later(30)).unwrap().id;
    f.store
        .add_work_card(&small, card("one"), later(31))
        .unwrap();
    let mut backup = backup_of(&f.store, &small);
    backup.board.name = "A".into();
    let board = backup.validate().unwrap();
    f.store.restore_project(&a, &board).unwrap();

    let after = f.store.counters(&a).unwrap();
    assert_eq!(after.next_card_id, counters.next_card_id);
    assert_eq!(after.next_history_id, counters.next_history_id);
    let fresh = f.store.add_work_card(&a, card("fresh"), later(40)).unwrap();
    assert_eq!(fresh.id, counters.next_card_id);
    assert_eq!(fresh.history[0].id, counters.next_history_id);
}

#[test]
fn restore_raises_the_counters_to_cover_the_backup() {
    let f = fixture();
    let a = f.store.create_project("A", now()).unwrap().id;
    let big = busy_project(&f.store, "big", later(1));
    let mut backup = backup_of(&f.store, &big);
    backup.board.name = "A".into();
    let board = backup.validate().unwrap();
    f.store.restore_project(&a, &board).unwrap();
    let counters = f.store.counters(&a).unwrap();
    assert_eq!(counters.next_card_id, 3);
    assert_eq!(counters.next_history_id, 6);
}

#[test]
fn a_restore_can_rename_the_project_and_bumps_the_catalog_once() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let before = f.store.projects().unwrap();
    let mut backup = backup_of(&f.store, &a);
    backup.board.name = "A renamed".into();
    let board = backup.validate().unwrap();
    let meta = f.store.restore_project(&a, &board).unwrap();
    assert_eq!(meta.name, "A renamed");
    assert_eq!(f.store.project(&a).unwrap().name, "A renamed");
    assert_eq!(
        f.store.projects().unwrap().catalog_revision,
        before.catalog_revision + 1
    );
    assert!(matches!(
        f.store.project_by_name("A"),
        Err(SkanError::ProjectNotFound { .. })
    ));
}

#[test]
fn a_name_another_project_uses_rolls_the_whole_restore_back() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let b = busy_project(&f.store, "B", later(10));
    let mut backup = backup_of(&f.store, &b);
    backup.board.name = "B".into();
    // Different content, so a partial restore would be visible.
    backup.cards.truncate(1);
    backup.cards[0].title = "from a backup".into();
    backup.cards[0].history.truncate(1);
    backup.cards[0].card_status = Column::Todo;
    backup.cards[0].agent_status = RunState::Idle;
    backup.cards[0].pending_reason = None;
    backup.cards[0].pending_request_id = None;
    let board = backup.validate().unwrap();

    let before_a = f.store.snapshot(&a).unwrap();
    let before_b = f.store.snapshot(&b).unwrap();
    let catalog = f.store.projects().unwrap();
    let counters = f.store.counters(&a).unwrap();

    let err = f.store.restore_project(&a, &board).unwrap_err();
    assert_eq!(err, SkanError::ProjectNameExists { name: "B".into() });
    assert_eq!(f.store.snapshot(&a).unwrap(), before_a);
    assert_eq!(f.store.snapshot(&b).unwrap(), before_b);
    assert_eq!(f.store.projects().unwrap(), catalog);
    assert_eq!(f.store.counters(&a).unwrap(), counters);
}

#[test]
fn restoring_an_unknown_project_creates_nothing() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let board = validated(f.store.snapshot(&a).unwrap());
    let ghost = ProjectId::generate().unwrap();
    let catalog = f.store.projects().unwrap();
    let err = f.store.restore_project(&ghost, &board).unwrap_err();
    assert!(matches!(err, SkanError::ProjectNotFound { .. }));
    assert_eq!(f.store.projects().unwrap(), catalog);
}

#[test]
fn a_failure_in_the_middle_of_inserting_leaves_everything_unchanged() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let b = busy_project(&f.store, "B", later(10));
    let source = f.store.snapshot(&b).unwrap();
    // Two cards with the same ID: the second insert fails after the first one
    // and the deletion of A's cards have already happened.
    let mut cards = source.cards.clone();
    cards[1].id = cards[0].id;
    let broken = ValidatedBoard {
        metadata: agent_board::domain::BoardMeta {
            name: "A".into(),
            next_card_id: 10,
            created_at: now(),
        },
        cards,
    };
    let before_a = f.store.snapshot(&a).unwrap();
    let before_b = f.store.snapshot(&b).unwrap();
    let catalog = f.store.projects().unwrap();
    let counters = f.store.counters(&a).unwrap();

    assert!(f.store.restore_project(&a, &broken).is_err());
    assert_eq!(f.store.snapshot(&a).unwrap(), before_a);
    assert_eq!(f.store.snapshot(&b).unwrap(), before_b);
    assert_eq!(f.store.projects().unwrap(), catalog);
    assert_eq!(f.store.counters(&a).unwrap(), counters);

    // The same for a new project: nothing is created.
    let renamed = ValidatedBoard {
        metadata: agent_board::domain::BoardMeta {
            name: "C".into(),
            ..broken.metadata.clone()
        },
        cards: broken.cards.clone(),
    };
    assert!(f.store.create_from_backup("C", &renamed).is_err());
    assert_eq!(f.store.projects().unwrap(), catalog);
}

#[test]
fn history_numbers_at_the_limit_fail_without_changing_anything() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let scratch = busy_project(&f.store, "scratch", later(10));
    let mut backup = backup_of(&f.store, &scratch);
    backup.board.name = "A".into();
    backup.cards[1].history[0].id = i64::MAX;
    let board = backup.validate().unwrap();

    let before_a = f.store.snapshot(&a).unwrap();
    let catalog = f.store.projects().unwrap();
    assert!(matches!(
        f.store.restore_project(&a, &board),
        Err(SkanError::DatabaseError { .. })
    ));
    assert_eq!(f.store.snapshot(&a).unwrap(), before_a);

    let mut backup = backup_of(&f.store, &scratch);
    backup.board.name = "fresh".into();
    backup.cards[1].history[0].id = i64::MAX;
    let board = backup.validate().unwrap();
    assert!(matches!(
        f.store.create_from_backup("fresh", &board),
        Err(SkanError::DatabaseError { .. })
    ));
    assert_eq!(f.store.projects().unwrap(), catalog);
}

#[test]
fn revision_at_the_limit_rolls_a_restore_back() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let board = validated(f.store.snapshot(&a).unwrap());
    let conn = rusqlite::Connection::open(f._dir.path().join("board.db")).unwrap();
    conn.execute(
        "UPDATE projects SET revision = ?1 WHERE id = ?2",
        rusqlite::params![i64::MAX, a.as_str()],
    )
    .unwrap();
    let before = f.store.snapshot(&a).unwrap();
    assert!(matches!(
        f.store.restore_project(&a, &board),
        Err(SkanError::DatabaseError { .. })
    ));
    assert_eq!(f.store.snapshot(&a).unwrap(), before);
}

#[test]
fn invalid_backups_are_rejected_before_any_restore() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let good = backup_of(&f.store, &a);
    assert!(good.clone().validate().is_ok());

    let reject = |mutate: &dyn Fn(&mut Backup), what: &str| {
        let mut backup = good.clone();
        mutate(&mut backup);
        let err = backup.validate().unwrap_err();
        assert!(
            matches!(err, SkanError::ImportInvalid { .. }),
            "{what}: {err:?}"
        );
    };
    reject(&|b| b.version = 1, "old version");
    reject(&|b| b.format = "other".into(), "format");
    reject(&|b| b.board.name = " padded ".into(), "name not trimmed");
    reject(&|b| b.board.name = "x".repeat(51), "long name");
    reject(
        &|b| b.board.next_card_id = 2,
        "nextCardId not above the cards",
    );
    reject(&|b| b.cards[1].id = 1, "duplicate card id");
    reject(&|b| b.cards[1].history[0].id = 1, "duplicate history id");
    reject(&|b| b.cards[0].history[1].reason = None, "missing reason");
    reject(
        &|b| b.cards[0].history[1].from_card_status = Some(Column::Doing),
        "discontinuous history",
    );
    reject(
        &|b| b.cards[0].pending_request_id = Some("other".into()),
        "request mismatch",
    );
    reject(
        &|b| b.cards[0].agent_status = RunState::Idle,
        "state does not match history",
    );
    reject(
        &|b| b.cards[1].agent_status = RunState::Running,
        "state invalid for lane",
    );
    reject(&|b| b.cards[1].history.clear(), "no created event");
    reject(
        &|b| b.cards[0].history[3].request_id = None,
        "pending without request",
    );
}

#[test]
fn an_answered_request_must_match_its_pending_request() {
    let f = fixture();
    let a = busy_project(&f.store, "A", now());
    let request = f.store.card(&a, 1).unwrap().pending_request_id.unwrap();
    f.store
        .answer_request(&a, 1, &request, ctx("use the first"), later(20))
        .unwrap();
    let good = backup_of(&f.store, &a);
    assert!(good.clone().validate().is_ok());
    let mut bad = good;
    let last = bad.cards[0].history.len() - 1;
    bad.cards[0].history[last].request_id = Some("0123456789abcdef0123456789abcdef".into());
    assert!(matches!(
        bad.validate().unwrap_err(),
        SkanError::ImportInvalid { .. }
    ));
}

// ---- the commands that decide between creating and replacing -------------

mod commands {
    use super::*;
    use agent_board::cli::args::{ImportArgs, InitArgs};
    use agent_board::cli::commands::{import, init};
    use agent_board::cli::{Context, Target};
    use agent_board::clock::SystemClock;
    use std::io::Cursor;

    fn context(store: ProjectStore, target: Target) -> Context {
        Context {
            store,
            target,
            clock: Box::new(SystemClock),
            json: false,
            interactive: true,
        }
    }

    fn open(f: &Fixture) -> ProjectStore {
        ProjectStore::open(&f._dir.path().join("board.db")).unwrap()
    }

    fn existing(f: &Fixture, id: &ProjectId) -> Context {
        let meta = f.store.project(id).unwrap();
        context(open(f), Target::Existing(meta))
    }

    fn answer(text: &str) -> Cursor<Vec<u8>> {
        Cursor::new(text.as_bytes().to_vec())
    }

    fn write_backup(f: &Fixture, backup: &Backup) -> std::path::PathBuf {
        let path = f._dir.path().join("backup.json");
        std::fs::write(&path, serde_json::to_vec_pretty(backup).unwrap()).unwrap();
        path
    }

    #[test]
    fn init_of_an_existing_project_empties_only_it_after_a_yes() {
        let f = fixture();
        let a = busy_project(&f.store, "A", now());
        let b = busy_project(&f.store, "B", later(10));
        let before_b = f.store.snapshot(&b).unwrap();
        let counters = f.store.counters(&a).unwrap();

        // "n" and an empty answer cancel.
        for no in ["n\n", "\n", ""] {
            let ctx = existing(&f, &a);
            let mut prompt = Vec::new();
            let outcome =
                init::run_with_io(&ctx, &InitArgs {}, &mut answer(no), &mut prompt).unwrap();
            assert!(!outcome.changed);
            assert_eq!(f.store.counters(&a).unwrap(), counters, "{no:?}");
            assert_eq!(f.store.snapshot(&a).unwrap().cards.len(), 2);
            assert!(String::from_utf8(prompt).unwrap().contains("\"A\""));
        }

        let ctx = existing(&f, &a);
        let outcome =
            init::run_with_io(&ctx, &InitArgs {}, &mut answer("yes\n"), &mut Vec::new()).unwrap();
        assert!(outcome.changed);
        let after = f.store.snapshot(&a).unwrap();
        assert!(after.cards.is_empty());
        assert_eq!(after.project.id, a);
        assert_eq!(after.revision, counters.revision + 1);
        assert_eq!(after.board.next_card_id, counters.next_card_id);
        assert_eq!(f.store.snapshot(&b).unwrap(), before_b);
    }

    #[test]
    fn init_creates_a_missing_project_and_refuses_to_replace_without_a_human() {
        let f = fixture();
        let a = busy_project(&f.store, "A", now());
        let ctx = context(
            open(&f),
            Target::Missing {
                name: "Fresh".into(),
            },
        );
        let outcome =
            init::run_with_io(&ctx, &InitArgs {}, &mut answer(""), &mut Vec::new()).unwrap();
        assert!(outcome.changed);
        assert!(f.store.project_by_name("Fresh").is_ok());

        // Non-interactive and JSON never replace.
        let before = f.store.snapshot(&a).unwrap();
        for (json, interactive) in [(false, false), (true, true), (true, false)] {
            let mut ctx = existing(&f, &a);
            ctx.json = json;
            ctx.interactive = interactive;
            let error = init::run_with_io(&ctx, &InitArgs {}, &mut answer("y\n"), &mut Vec::new())
                .err()
                .unwrap();
            assert!(matches!(error, SkanError::ConfirmationRequired { .. }));
        }
        assert_eq!(f.store.snapshot(&a).unwrap(), before);
    }

    #[test]
    fn a_project_deleted_and_recreated_while_waiting_is_never_replaced() {
        let f = fixture();
        let a = busy_project(&f.store, "A", now());
        let ctx = existing(&f, &a); // the ID is fixed here
        f.store.delete_project(&a).unwrap();
        let reborn = busy_project(&f.store, "A", later(30));
        let before = f.store.snapshot(&reborn).unwrap();

        let error = init::run_with_io(&ctx, &InitArgs {}, &mut answer("y\n"), &mut Vec::new())
            .err()
            .unwrap();
        assert!(
            matches!(error, SkanError::ProjectNotFound { .. }),
            "{error:?}"
        );
        let backup = backup_of(&f.store, &reborn);
        let path = write_backup(&f, &backup);
        let error = import::run_with_io(
            &ctx,
            &ImportArgs { file: Some(path) },
            &mut answer("y\n"),
            &mut Vec::new(),
        )
        .err()
        .unwrap();
        assert!(
            matches!(error, SkanError::ProjectNotFound { .. }),
            "{error:?}"
        );
        assert_eq!(f.store.snapshot(&reborn).unwrap(), before);
    }

    #[test]
    fn import_into_an_existing_project_replaces_it_only_after_a_yes() {
        let f = fixture();
        let a = busy_project(&f.store, "A", now());
        let b = busy_project(&f.store, "B", later(10));
        let scratch = busy_project(&f.store, "scratch", later(20));
        let mut backup = backup_of(&f.store, &scratch);
        backup.board.name = "A renamed".into();
        let path = write_backup(&f, &backup);
        let args = ImportArgs { file: Some(path) };
        let before_a = f.store.snapshot(&a).unwrap();
        let before_b = f.store.snapshot(&b).unwrap();

        let ctx = existing(&f, &a);
        let mut prompt = Vec::new();
        let cancelled = import::run_with_io(&ctx, &args, &mut answer("n\n"), &mut prompt).unwrap();
        assert!(!cancelled.changed);
        let prompt = String::from_utf8(prompt).unwrap();
        // The prompt names the old and the restored name.
        assert!(
            prompt.contains("\"A\"") && prompt.contains("\"A renamed\""),
            "{prompt}"
        );
        assert_eq!(f.store.snapshot(&a).unwrap(), before_a);

        let done = import::run_with_io(&ctx, &args, &mut answer("y\n"), &mut Vec::new()).unwrap();
        assert!(done.changed);
        let after = f.store.snapshot(&a).unwrap();
        assert_eq!(after.project.id, a);
        assert_eq!(after.board.name, "A renamed");
        assert_eq!(after.cards.len(), 2);
        assert_eq!(after.revision, before_a.revision + 1);
        assert_eq!(f.store.snapshot(&b).unwrap(), before_b);
    }

    #[test]
    fn import_of_a_missing_project_needs_no_confirmation_but_a_matching_name() {
        let f = fixture();
        let a = busy_project(&f.store, "A", now());
        let backup = backup_of(&f.store, &a);
        let path = write_backup(&f, &backup);
        let args = ImportArgs { file: Some(path) };
        // A name that does not match the backup is refused; nothing is created.
        let ctx = context(open(&f), Target::Missing { name: "Z".into() });
        let error = import::run_with_io(&ctx, &args, &mut answer(""), &mut Vec::new())
            .err()
            .unwrap();
        assert!(matches!(error, SkanError::ImportInvalid { .. }));
        assert!(f.store.project_by_name("Z").is_err());

        f.store.delete_project(&a).unwrap();
        let mut ctx = context(open(&f), Target::Missing { name: "A".into() });
        ctx.json = true;
        ctx.interactive = false;
        let outcome = import::run_with_io(&ctx, &args, &mut answer(""), &mut Vec::new()).unwrap();
        assert!(outcome.changed);
        assert_eq!(f.store.project_by_name("A").unwrap().name, "A");
    }
}

#[test]
fn drafts_survive_an_export_and_import_round_trip() {
    let f = fixture();
    let id = f.store.create_project("Drafts", now()).unwrap().id;
    f.store.add_work_card(&id, card("plain"), now()).unwrap();
    f.store.add_work_card(&id, card("draft"), later(1)).unwrap();
    f.store.set_draft(&id, 2, true).unwrap();
    let text = serde_json::to_string_pretty(&backup_of(&f.store, &id)).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["cards"][0]["isDraft"], false);
    assert_eq!(value["cards"][1]["isDraft"], true);

    let board = serde_json::from_str::<Backup>(&text)
        .unwrap()
        .validate()
        .unwrap();
    let copy = f.store.create_from_backup("Drafts", &board);
    assert!(copy.is_err(), "name is taken");
    f.store.restore_project(&id, &board).unwrap();
    let cards = f.store.snapshot(&id).unwrap().cards;
    assert!(!cards[0].is_draft);
    assert!(cards[1].is_draft);
}

#[test]
fn a_backup_without_is_draft_imports_as_non_drafts() {
    let f = fixture();
    let id = f.store.create_project("Old", now()).unwrap().id;
    f.store.add_work_card(&id, card("one"), now()).unwrap();
    let text = serde_json::to_string(&backup_of(&f.store, &id)).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
    for c in value["cards"].as_array_mut().unwrap() {
        c.as_object_mut().unwrap().remove("isDraft");
    }
    let board = serde_json::from_value::<Backup>(value)
        .unwrap()
        .validate()
        .unwrap();
    let created = {
        f.store.delete_project(&id).ok();
        f.store.create_from_backup("Old", &board).unwrap()
    };
    let cards = f.store.snapshot(&created.id).unwrap().cards;
    assert_eq!(cards.len(), 1);
    assert!(!cards[0].is_draft);
}

#[test]
fn a_draft_that_is_not_idle_is_rejected() {
    let f = fixture();
    let id = busy_project(&f.store, "Busy", now());
    let mut value = serde_json::to_value(backup_of(&f.store, &id)).unwrap();
    value["cards"][0]["isDraft"] = serde_json::json!(true);
    let err = serde_json::from_value::<Backup>(value)
        .unwrap()
        .validate()
        .unwrap_err();
    assert!(matches!(err, SkanError::ImportInvalid { .. }));
}

#[test]
fn a_backup_description_over_the_limit_is_rejected_and_the_limit_is_accepted() {
    let f = fixture();
    let id = f.store.create_project("Long", now()).unwrap().id;
    f.store.add_work_card(&id, card("one"), now()).unwrap();
    let mut value = serde_json::to_value(backup_of(&f.store, &id)).unwrap();
    value["cards"][0]["description"] = serde_json::json!("a".repeat(50_000));
    assert!(
        serde_json::from_value::<Backup>(value.clone())
            .unwrap()
            .validate()
            .is_ok()
    );
    value["cards"][0]["description"] = serde_json::json!("a".repeat(50_001));
    assert!(
        serde_json::from_value::<Backup>(value)
            .unwrap()
            .validate()
            .is_err()
    );
}
