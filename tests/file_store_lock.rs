//! File locks: the lifecycle lock refuses a second holder at once, and the
//! project write lock makes a second writer wait instead of failing.

use std::sync::mpsc;
use std::time::Duration;

use agent_board::error::AgboardError;
use agent_board::file_store::lock::{LifecycleLock, WriteLock};
use agent_board::lifecycle::LifecycleGuard;

#[test]
fn lifecycle_lock_refuses_a_second_holder_until_the_first_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let first = LifecycleGuard::acquire(dir.path()).unwrap();

    let Err(err) = LifecycleLock::acquire(dir.path()) else {
        panic!("a second lifecycle lock must not be granted");
    };
    assert_eq!(err, AgboardError::DatabaseBusy);

    drop(first);
    LifecycleLock::acquire(dir.path()).unwrap();
}

#[test]
fn lifecycle_lock_is_a_plain_file() {
    let dir = tempfile::tempdir().unwrap();
    let _guard = LifecycleGuard::acquire(dir.path()).unwrap();
    assert!(dir.path().join("lifecycle.lock").is_file());
}

#[test]
fn the_project_write_lock_waits_for_the_holder_instead_of_failing() {
    let dir = tempfile::tempdir().unwrap();
    let lock_path = dir.path().join(".internal").join("write.lock");
    let held = WriteLock::acquire(&lock_path).unwrap();

    let (tx, rx) = mpsc::channel();
    let path = lock_path.clone();
    let waiter = std::thread::spawn(move || {
        let _lock = WriteLock::acquire(&path).unwrap();
        tx.send(()).unwrap();
    });

    assert!(
        rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "the second writer must wait while the first holds the lock"
    );
    drop(held);
    rx.recv_timeout(Duration::from_secs(5))
        .expect("the second writer proceeds after the release");
    waiter.join().unwrap();
}
