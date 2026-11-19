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
    assert!(loaded.kinds.results && loaded.kinds.questions);
    assert!(!loaded.kinds.state_changes && !loaded.kinds.history);
    assert!(!loaded.periodic.enabled);
    assert_eq!(loaded.periodic.interval_minutes, 60);
}

#[test]
fn a_saved_value_is_read_back_and_all_off_is_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    let saved = s
        .update(patch(serde_json::json!({
            "kinds": {"results": false, "questions": false, "stateChanges": false, "history": false},
            "periodic": {"enabled": true, "intervalMinutes": 240}
        })))
        .unwrap();
    assert_eq!(s.load(), saved);
    assert!(!saved.kinds.results && !saved.kinds.questions);
    assert!(saved.periodic.enabled);
    assert_eq!(saved.periodic.interval_minutes, 240);
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
            "stateChanges": {"started": false, "pending": true, "done": true}
        })))
        .unwrap();
    let next = s
        .update(patch(serde_json::json!({
            "periodic": {"enabled": true, "intervalMinutes": 30}
        })))
        .unwrap();
    assert!(!next.state_changes.started);
    assert_eq!(next.kinds, NotificationSettings::default().kinds);
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
    assert_eq!(
        s.update(patch(serde_json::json!({
            "periodic": {"enabled": true, "intervalMinutes": 45}
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
        br#"{"formatVersion":2,"revision":3,"kinds":{"results":false,"questions":false,"stateChanges":false,"history":false},"stateChanges":{"started":true,"pending":true,"done":true},"periodic":{"enabled":false,"intervalMinutes":60}}"#,
    )
    .unwrap();
    assert_eq!(store(tmp.path()).load(), NotificationSettings::default());
}

#[test]
fn a_state_change_is_wanted_only_when_the_kind_and_the_change_are_on() {
    let mut settings = NotificationSettings::default();
    assert!(!settings.wants_state_change(StateChange::Done));
    settings.kinds.state_changes = true;
    settings.state_changes.pending = false;
    assert!(settings.wants_state_change(StateChange::Done));
    assert!(!settings.wants_state_change(StateChange::Pending));
}

#[cfg(unix)]
#[test]
fn the_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    s.update(patch(serde_json::json!({
        "periodic": {"enabled": true, "intervalMinutes": 120}
    })))
    .unwrap();
    let mode = std::fs::metadata(&s.path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}
