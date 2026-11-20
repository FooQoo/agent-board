use super::*;

const ID: &str = "0123456789abcdef0123456789abcdef";

#[test]
fn a_rescan_announces_a_changed_notify_folder_once() {
    let root = tempfile::tempdir().unwrap();
    let id: ProjectId = ID.parse().unwrap();
    let notify = root.path().join("projects").join(ID).join("notify");
    fs::create_dir_all(&notify).unwrap();
    let mut prints = NotifyPrints::baseline(root.path());
    assert!(prints.changed_since(root.path()).is_empty());
    fs::write(notify.join("2026-11-20.ldjson"), "{}\n").unwrap();
    assert_eq!(prints.changed_since(root.path()), vec![id.clone()]);
    // The same rescan again, with nothing new, announces nothing.
    assert!(prints.changed_since(root.path()).is_empty());
    // A change an event already announced is not announced again by the rescan.
    fs::write(notify.join("2026-11-20.ldjson"), "{}\n{}\n").unwrap();
    prints.seen(root.path(), &id);
    assert!(prints.changed_since(root.path()).is_empty());
}
