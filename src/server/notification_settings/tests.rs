use super::*;

fn store(dir: &Path) -> NotificationSettingsStore {
    NotificationSettingsStore::new(dir)
}

fn patch(json: serde_json::Value) -> Patch {
    serde_json::from_value(json).unwrap()
}

#[test]
fn a_missing_file_reads_as_the_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    let loaded = store(tmp.path()).load();
    assert_eq!(loaded, NotificationSettings::default());
    assert!(loaded.kinds.results);
    assert!(!loaded.kinds.questions && !loaded.kinds.history);
}

#[test]
fn a_saved_value_is_read_back_and_all_off_is_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    let saved = s
        .update(patch(serde_json::json!({
            "kinds": {"results": false, "questions": false, "history": false}
        })))
        .unwrap();
    assert_eq!(s.load(), saved);
    assert!(!saved.kinds.results && !saved.kinds.questions);
    assert!(
        tmp.path()
            .join(".internal")
            .join("notification-settings.json")
            .is_file()
    );
}

#[test]
fn a_partial_save_keeps_the_other_groups_and_counts_revisions() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    let first = s
        .update(patch(serde_json::json!({
            "kinds": {"results": true, "questions": true, "history": false}
        })))
        .unwrap();
    let next = s
        .update(patch(serde_json::json!({
            "kinds": {"results": true, "questions": false, "history": true}
        })))
        .unwrap();
    assert!(!next.kinds.questions && next.kinds.history);
    assert_eq!(next.revision, first.revision + 1);
}

#[test]
fn invalid_patches_save_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    assert_eq!(
        s.update(patch(serde_json::json!({}))),
        Err(UpdateError::Invalid)
    );
    // The removed periodic group is accepted but is not something to save.
    assert_eq!(
        s.update(patch(serde_json::json!({
            "periodic": {"enabled": true, "intervalMinutes": 60}
        }))),
        Err(UpdateError::Invalid)
    );
    assert!(
        serde_json::from_value::<Patch>(serde_json::json!({"kinds": {"results": true}})).is_err()
    );
    assert!(serde_json::from_value::<Patch>(serde_json::json!({"extra": 1})).is_err());
    assert_eq!(s.load(), NotificationSettings::default());
    assert!(!tmp.path().join(".internal").exists());
}

#[test]
fn an_invalid_file_reads_as_the_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("notification-settings.json"), b"{not json").unwrap();
    assert_eq!(store(tmp.path()).load(), NotificationSettings::default());
    std::fs::write(
        dir.join("notification-settings.json"),
        br#"{"formatVersion":2,"revision":3,"kinds":{"results":false,"questions":false,"stateChanges":false,"history":false},"stateChanges":{"started":true,"pending":true,"done":true}}"#,
    )
    .unwrap();
    assert_eq!(store(tmp.path()).load(), NotificationSettings::default());
}

#[test]
fn a_file_saved_with_the_removed_periodic_group_still_loads_and_drops_it_on_save() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("notification-settings.json");
    std::fs::write(
        &file,
        br#"{"formatVersion":1,"revision":7,"kinds":{"results":false,"questions":true,"stateChanges":false,"history":false},"stateChanges":{"started":true,"pending":true,"done":true},"periodic":{"enabled":true,"intervalMinutes":240}}"#,
    )
    .unwrap();
    let s = store(tmp.path());
    let loaded = s.load();
    assert_eq!(loaded.revision, 7);
    assert!(!loaded.kinds.results && loaded.kinds.questions);
    let saved = s
        .update(patch(serde_json::json!({
            "kinds": {"results": true, "questions": true, "history": false}
        })))
        .unwrap();
    assert_eq!(saved.revision, 8);
    assert!(!std::fs::read_to_string(&file).unwrap().contains("periodic"));
}

#[cfg(unix)]
#[test]
fn the_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    s.update(patch(serde_json::json!({
        "kinds": {"results": true, "questions": true, "history": true}
    })))
    .unwrap();
    let mode = std::fs::metadata(&s.path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

#[test]
fn the_removed_state_change_groups_are_accepted_in_a_patch_and_ignored() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    // An older page may still send the retired kind and the retired group beside the kinds.
    let saved = s
        .update(patch(serde_json::json!({
            "kinds": {"results": true, "questions": false, "stateChanges": true, "history": false},
            "stateChanges": {"started": true, "pending": true, "done": true}
        })))
        .unwrap();
    assert_eq!(saved.kinds, NotificationSettings::default().kinds);
    // A patch with only the retired groups has nothing to save.
    assert_eq!(
        s.update(patch(
            serde_json::json!({"stateChanges": {"started": true, "pending": true, "done": true}})
        )),
        Err(UpdateError::Invalid)
    );
}
