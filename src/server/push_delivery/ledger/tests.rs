use super::*;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

fn entry(device: &str, key: &str, state: State, seconds: i64) -> Entry {
    Entry {
        device_id: device.to_string(),
        key: key.to_string(),
        state,
        attempts: 1,
        at: at(seconds),
        retry_at: None,
        payload: None,
    }
}

#[test]
fn an_event_is_remembered_per_device() {
    let ledger = Ledger::in_memory();
    assert!(!ledger.has("dev_a", "k"));
    ledger.record(entry("dev_a", "k", State::Sent, 0));
    assert!(ledger.has("dev_a", "k"));
    assert!(!ledger.has("dev_b", "k"));
    // A second record of the same event replaces the first.
    ledger.record(entry("dev_a", "k", State::Dropped, 1));
    assert_eq!(ledger.entries().len(), 1);
}

#[test]
fn the_ledger_survives_a_restart_in_an_owner_only_file() {
    let dir = tempfile::tempdir().unwrap();
    let ledger = Ledger::open(dir.path());
    ledger.record(entry("dev_a", "k", State::Sent, 0));
    let again = Ledger::open(dir.path());
    assert!(again.has("dev_a", "k"));
    let path = dir.path().join(".internal/push-ledger.json");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    // A file that cannot be read is an empty ledger.
    std::fs::write(&path, "not json").unwrap();
    assert!(Ledger::open(dir.path()).entries().is_empty());
}

#[test]
fn only_pending_entries_whose_time_has_come_are_due() {
    let ledger = Ledger::in_memory();
    let mut later = entry("dev_a", "later", State::Pending, 0);
    later.retry_at = Some(at(600));
    let mut soon = entry("dev_a", "soon", State::Pending, 0);
    soon.retry_at = Some(at(60));
    ledger.record(later);
    ledger.record(soon);
    ledger.record(entry("dev_a", "done", State::Sent, 0));
    let due = ledger.due(at(100));
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].key, "soon");
    assert_eq!(ledger.due(at(700)).len(), 2);
}

#[test]
fn old_finished_entries_are_forgotten_but_pending_ones_stay() {
    let ledger = Ledger::in_memory();
    ledger.record(entry("dev_a", "old", State::Sent, 0));
    let mut waiting = entry("dev_a", "waiting", State::Pending, 0);
    waiting.retry_at = Some(at(60));
    ledger.record(waiting);
    ledger.record(entry("dev_a", "new", State::Sent, 15 * 24 * 3600));
    let keys: Vec<String> = ledger.entries().into_iter().map(|e| e.key).collect();
    assert_eq!(keys, ["waiting", "new"]);
}

#[test]
fn the_ledger_is_bounded() {
    let ledger = Ledger::in_memory();
    for n in 0..(MAX_FINISHED + 50) {
        ledger.record(entry("dev_a", &format!("k{n}"), State::Sent, n as i64));
    }
    assert_eq!(ledger.entries().len(), MAX_FINISHED);
    assert!(!ledger.has("dev_a", "k0"));
    assert!(ledger.has("dev_a", &format!("k{}", MAX_FINISHED + 49)));
}

#[test]
fn forgetting_a_device_removes_its_entries() {
    let ledger = Ledger::in_memory();
    ledger.record(entry("dev_a", "k", State::Sent, 0));
    ledger.record(entry("dev_b", "k", State::Sent, 0));
    ledger.forget_device("dev_a");
    assert!(!ledger.has("dev_a", "k"));
    assert!(ledger.has("dev_b", "k"));
}
