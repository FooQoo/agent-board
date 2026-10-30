use super::*;

fn store(dir: &Path) -> PreferencesStore {
    PreferencesStore::new(dir)
}

fn theme(mode: &str, accent: &str) -> Theme {
    Theme {
        mode: mode.to_string(),
        accent: accent.to_string(),
    }
}

#[test]
fn a_missing_file_reads_as_the_defaults() {
    let tmp = tempfile::tempdir().unwrap();
    assert_eq!(store(tmp.path()).load(), Preferences::default());
}

#[test]
fn a_saved_value_is_read_back_with_its_revision() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    let saved = s
        .update(Patch {
            locale: Some("ja".to_string()),
            theme: Some(theme("dark", "teal")),
        })
        .unwrap();
    assert!(saved.revision >= unix_millis().saturating_sub(60_000));
    assert_eq!(s.load(), saved);
    assert!(
        tmp.path()
            .join(".internal")
            .join("preferences.json")
            .is_file()
    );
}

#[test]
fn a_partial_save_keeps_the_other_field() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    let first = s
        .update(Patch {
            locale: Some("ja".to_string()),
            theme: Some(theme("dark", "teal")),
        })
        .unwrap();
    assert!(first.revision > 0);
    let next = s
        .update(Patch {
            locale: None,
            theme: Some(theme("light", "red")),
        })
        .unwrap();
    assert_eq!(next.locale, "ja");
    assert_eq!(next.theme, theme("light", "red"));
    assert_eq!(next.revision, first.revision + 1);
}

#[test]
fn an_invalid_value_or_an_empty_patch_changes_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let s = store(tmp.path());
    s.update(Patch {
        locale: Some("ja".to_string()),
        theme: None,
    })
    .unwrap();
    let before = s.load();
    for patch in [
        Patch {
            locale: Some("fr".to_string()),
            theme: None,
        },
        Patch {
            locale: None,
            theme: Some(theme("neon", "blue")),
        },
        Patch {
            locale: None,
            theme: Some(theme("light", "magenta")),
        },
        Patch {
            locale: None,
            theme: None,
        },
    ] {
        assert_eq!(s.update(patch), Err(UpdateError::Invalid));
    }
    assert_eq!(s.load(), before);
}

#[test]
fn a_broken_file_reads_as_the_defaults_and_the_next_save_replaces_it() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("preferences.json"), b"{ not json").unwrap();
    let s = store(tmp.path());
    assert_eq!(s.load(), Preferences::default());
    let saved = s
        .update(Patch {
            locale: Some("ja".to_string()),
            theme: None,
        })
        .unwrap();
    assert_eq!(saved.theme, Preferences::default().theme);
    assert_eq!(s.load(), saved);
}

#[test]
fn a_save_after_an_invalid_file_gets_a_timestamp_revision_then_counts_up() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("preferences.json"), b"{ not json").unwrap();
    let s = store(tmp.path());
    let patch = || Patch {
        locale: Some("ja".to_string()),
        theme: None,
    };
    let first = s.update(patch()).unwrap();
    assert!(first.revision > 1_000_000_000_000, "{}", first.revision);
    let second = s.update(patch()).unwrap();
    assert_eq!(second.revision, first.revision + 1);
}

#[test]
fn a_leftover_temporary_file_is_removed_by_a_save() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    let stale = dir.join("preferences.json.123.tmp");
    std::fs::write(&stale, b"half").unwrap();
    store(tmp.path())
        .update(Patch {
            locale: Some("ja".to_string()),
            theme: None,
        })
        .unwrap();
    assert!(!stale.exists());
}

#[test]
fn a_file_with_unknown_keys_or_another_version_is_not_used() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join(".internal");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("preferences.json");
    std::fs::write(
        &path,
        br#"{"formatVersion":1,"revision":4,"locale":"ja","theme":{"mode":"dark","accent":"teal"},"extra":1}"#,
    )
    .unwrap();
    assert_eq!(store(tmp.path()).load(), Preferences::default());
    std::fs::write(
        &path,
        br#"{"formatVersion":2,"revision":4,"locale":"ja","theme":{"mode":"dark","accent":"teal"}}"#,
    )
    .unwrap();
    assert_eq!(store(tmp.path()).load(), Preferences::default());
}

#[cfg(unix)]
#[test]
fn the_file_is_owner_only_and_no_temporary_file_remains() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    store(tmp.path())
        .update(Patch {
            locale: Some("ja".to_string()),
            theme: None,
        })
        .unwrap();
    let path = tmp.path().join(".internal").join("preferences.json");
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn a_save_that_cannot_be_written_reports_unavailable() {
    let tmp = tempfile::tempdir().unwrap();
    // A regular file where the internal folder should be makes the write fail.
    std::fs::write(tmp.path().join(".internal"), b"x").unwrap();
    let result = store(tmp.path()).update(Patch {
        locale: Some("ja".to_string()),
        theme: None,
    });
    assert_eq!(result, Err(UpdateError::Unavailable));
    assert_eq!(store(tmp.path()).load(), Preferences::default());
}
