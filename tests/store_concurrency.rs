use std::collections::HashSet;
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use skan::error::SkanError;
use skan::store::Store;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, 0, 0).unwrap()
}

#[test]
fn two_connections_writing_concurrently_keep_the_database_consistent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    Store::open(&path)
        .unwrap()
        .create_board("main", now())
        .unwrap();

    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|worker| {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let store = Store::open(&path).unwrap();
                barrier.wait();
                for n in 0..50 {
                    store
                        .add_card(&format!("worker {worker} card {n}"), "", now())
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }

    let store = Store::open(&path).unwrap();
    let cards = store.list_cards(None, None).unwrap();
    assert_eq!(cards.len(), 100);
    let ids: HashSet<i64> = cards.iter().map(|c| c.id).collect();
    assert_eq!(ids.len(), 100);
    assert_eq!(ids, (1..=100).collect());
    let positions: HashSet<i64> = cards.iter().map(|c| c.position).collect();
    assert_eq!(positions, (1..=100).collect());
    assert_eq!(store.board().unwrap().unwrap().next_card_id, 101);
    for card in &cards {
        assert_eq!(card.transitions.len(), 1);
    }
    let check: String = Connection::open(&path)
        .unwrap()
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(check, "ok");
}

#[test]
fn a_write_blocked_past_the_wait_time_is_database_busy_and_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    Store::open(&path)
        .unwrap()
        .create_board("main", now())
        .unwrap();

    // another connection holds the write lock
    let blocker = Connection::open(&path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();

    let impatient = Store::open_with_busy_timeout(&path, Duration::from_millis(150)).unwrap();
    let started = Instant::now();
    let err = impatient.add_card("blocked", "", now()).unwrap_err();
    let waited = started.elapsed();
    assert_eq!(err, SkanError::DatabaseBusy);
    assert!(
        waited >= Duration::from_millis(100),
        "returned too early: {waited:?}"
    );
    assert!(
        waited < Duration::from_secs(4),
        "waited too long: {waited:?}"
    );

    // other writers fail the same way
    assert_eq!(
        impatient.reset_board("x", now()).map(|_| ()),
        Err(SkanError::DatabaseBusy)
    );

    // reads still see the last committed state while the lock is held
    assert_eq!(impatient.list_cards(None, None).unwrap(), vec![]);
    assert_eq!(impatient.board().unwrap().unwrap().next_card_id, 1);

    // once the lock is released, writes work and nothing from the failed attempts remains
    blocker.execute_batch("ROLLBACK").unwrap();
    let card = impatient.add_card("after", "", now()).unwrap();
    assert_eq!(card.id, 1);
    assert_eq!(impatient.list_cards(None, None).unwrap().len(), 1);
}

#[test]
fn a_writer_waits_for_a_short_lock_and_then_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("board.db");
    Store::open(&path)
        .unwrap()
        .create_board("main", now())
        .unwrap();

    let blocker = Connection::open(&path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        blocker.execute_batch("COMMIT").unwrap();
    });

    let store = Store::open(&path).unwrap(); // default 5 second wait
    let card = store.add_card("patient", "", now()).unwrap();
    assert_eq!(card.id, 1);
    release.join().unwrap();
}
