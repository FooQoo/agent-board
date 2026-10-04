use std::collections::HashSet;
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use skan::domain::{Actor, Assignee, NewCard};
use skan::error::SkanError;
use skan::store::Store;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 2, 1, 0, 0).unwrap()
}
fn new_card(title: String) -> NewCard {
    NewCard {
        title,
        description: String::new(),
        assignee: Assignee::Ai,
        actor: Actor::Ai,
    }
}

#[test]
fn concurrent_writers_allocate_unique_ids_positions_and_revisions() {
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
                        .add_work_card(new_card(format!("worker {worker} card {n}")), now())
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    let store = Store::open(&path).unwrap();
    let snapshot = store.snapshot().unwrap();
    assert_eq!(snapshot.cards.len(), 100);
    assert_eq!(snapshot.revision, 100);
    assert_eq!(snapshot.board.next_card_id, 101);
    let ids: HashSet<_> = snapshot.cards.iter().map(|c| c.id).collect();
    assert_eq!(ids, (1..=100).collect());
    let positions: HashSet<_> = snapshot.cards.iter().map(|c| c.position).collect();
    assert_eq!(positions, (1..=100).collect());
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
    let blocker = Connection::open(&path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let impatient = Store::open_with_busy_timeout(&path, Duration::from_millis(150)).unwrap();
    let started = Instant::now();
    let err = impatient
        .add_work_card(new_card("blocked".into()), now())
        .unwrap_err();
    let waited = started.elapsed();
    assert_eq!(err, SkanError::DatabaseBusy);
    assert!(waited >= Duration::from_millis(100));
    assert!(waited < Duration::from_secs(4));
    blocker.execute_batch("ROLLBACK").unwrap();
    let card = impatient
        .add_work_card(new_card("after".into()), now())
        .unwrap();
    assert_eq!(card.id, 1);
}
